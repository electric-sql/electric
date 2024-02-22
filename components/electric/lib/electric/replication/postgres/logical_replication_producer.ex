defmodule Electric.Replication.Postgres.LogicalReplicationProducer do
  use GenStage
  require Logger

  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Telemetry.Metrics

  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.LogicalReplication.Messages

  alias Electric.Postgres.LogicalReplication.Messages.{
    Begin,
    Origin,
    Commit,
    Relation,
    Insert,
    Update,
    Delete,
    Truncate,
    Type,
    Message
  }

  alias Electric.Postgres.Lsn

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation,
    ReferencedRecord
  }

  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client

  defmodule State do
    defstruct conn: nil,
              conn_opts: %{},
              demand: 0,
              queue: nil,
              relations: %{},
              transaction: nil,
              publication: nil,
              client: nil,
              origin: nil,
              types: %{},
              span: nil,
              main_slot: "",
              main_slot_lsn: %Lsn{},
              resumable_wal_window: 1

    @type t() :: %__MODULE__{
            conn: pid(),
            conn_opts: Connectors.connection_opts(),
            demand: non_neg_integer(),
            queue: :queue.queue(),
            relations: %{Messages.relation_id() => %Relation{}},
            transaction: {Lsn.t(), %Transaction{}},
            publication: binary(),
            origin: Connectors.origin(),
            types: %{},
            span: Metrics.t() | nil,
            main_slot: binary(),
            main_slot_lsn: Lsn.t(),
            resumable_wal_window: pos_integer()
          }
  end

  @spec start_link(Connectors.config()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(connector_config) do
    GenStage.start_link(__MODULE__, connector_config, name: name(connector_config))
  end

  @spec name(Connectors.config()) :: Electric.reg_name()
  def name(connector_config) when is_list(connector_config) do
    name(Connectors.origin(connector_config))
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  @impl true
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    conn_opts = Connectors.get_connection_opts(connector_config, replication: true)
    repl_opts = Connectors.get_replication_opts(connector_config)
    wal_window_opts = Connectors.get_wal_window_opts(connector_config)

    publication = repl_opts.publication
    main_slot = repl_opts.slot
    tmp_slot = main_slot <> "_rc"

    Logger.metadata(pg_producer: origin)

    Logger.info(
      "Starting replication with publication=#{publication} and slots=#{main_slot},#{tmp_slot}}"
    )

    with {:ok, conn} <- Client.connect(conn_opts),
         # Refactoring note: make sure that both slots are created first thing after a
         # connection is opened. In particular, trying to call `Client.get_server_versions()` before
         # creating the main slot results in the replication stream not delivering transactions from
         # Postgres when Electric is running in the direct_writes mode, which manifests as a
         # failure of e2e/tests/02.02_migrations_get_streamed_to_satellite.lux.
         {:ok, _slot_name} <- Client.create_main_slot(conn, main_slot),
         {:ok, _slot_name, main_slot_lsn} <-
           Client.create_temporary_slot(conn, main_slot, tmp_slot),
         {:ok, current_lsn} <- Client.current_lsn(conn),
         start_lsn = starting_lsn_for_replication(main_slot_lsn, current_lsn, wal_window_opts),
         :ok <- Client.set_display_settings_for_replication(conn),
         {:ok, {short, long, cluster}} <- Client.get_server_versions(conn),
         {:ok, table_count} <- SchemaLoader.count_electrified_tables({SchemaCache, origin}),
         :ok <- Client.start_replication(conn, publication, tmp_slot, start_lsn, self()) do
      # Monitor the connection process to no when to stop the telemetry span created on the next line.
      Process.monitor(conn)

      span =
        Metrics.start_span([:postgres, :replication_from], %{electrified_tables: table_count}, %{
          cluster: cluster,
          short_version: short,
          long_version: long
        })

      {:producer,
       %State{
         conn: conn,
         conn_opts: Connectors.get_connection_opts(connector_config),
         queue: :queue.new(),
         publication: publication,
         origin: origin,
         span: span,
         main_slot: main_slot,
         main_slot_lsn: main_slot_lsn,
         resumable_wal_window: wal_window_opts.resumable_size
       }}
    end
  end

  # Calculate the starting point such that all of the available in-memory WAL cache is filled.
  #
  # TODO(optimization): fetch the last ack'ed LSN from acknowledged_client_lsns and use that as
  # the starting point.
  defp starting_lsn_for_replication(main_slot_lsn, current_lsn, wal_window_opts) do
    lsn = Lsn.increment(current_lsn, -wal_window_opts.in_memory_size)

    if Lsn.compare(main_slot_lsn, lsn) == :lt do
      lsn
    else
      # Can't return an lsn that's earlier than the main replication slot's starting point.
      main_slot_lsn
    end
  end

  @impl true
  def terminate(_reason, state) do
    Metrics.stop_span(state.span)
  end

  @impl true
  def handle_info({:epgsql, _pid, {:x_log_data, _start_lsn, _end_lsn, binary_msg}}, state) do
    binary_msg
    |> LogicalReplication.decode_message()
    |> process_message(state)
  end

  def handle_info({:DOWN, _, :process, conn, reason}, %State{conn: conn} = state) do
    Logger.warning("PostgreSQL closed the replication connection")
    Metrics.stop_span(state.span)

    {:stop, reason, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("Unexpected message #{inspect(msg)}")
    {:noreply, [], state}
  end

  defp process_message(
         %Message{transactional?: true, prefix: "electric.fk_chain_touch", content: content},
         state
       ) do
    received = Jason.decode!(content)

    referenced = %ReferencedRecord{
      relation: {received["schema"], received["table"]},
      record: received["data"],
      pk: received["pk"],
      tags:
        ShadowTableTransformation.convert_tag_list_pg_to_satellite(received["tags"], state.origin)
    }

    {lsn, txn} = state.transaction

    {:noreply, [],
     %{state | transaction: {lsn, Transaction.add_referenced_record(txn, referenced)}}}
  end

  defp process_message(%Message{} = msg, state) do
    Logger.info("Got a message from PG via logical replication: #{inspect(msg)}")

    {:noreply, [], state}
  end

  defp process_message(%Begin{} = msg, %State{} = state) do
    tx = %Transaction{
      xid: msg.xid,
      changes: [],
      commit_timestamp: msg.commit_timestamp,
      origin: state.origin,
      origin_type: :postgresql,
      publication: state.publication
    }

    {:noreply, [], %{state | transaction: {msg.final_lsn, tx}}}
  end

  defp process_message(%Origin{} = msg, state) do
    # If we got the "origin" message, it means that the Postgres sending back the transaction we sent from Electric
    # We ignored those previously, when Vaxine was the source of truth, but now we need to fan out those processed messages
    # to all the Satellites as their write has been "accepted"
    Logger.debug("origin: #{inspect(msg.name)}")
    {:noreply, [], state}
  end

  defp process_message(%Type{}, state), do: {:noreply, [], state}

  defp process_message(%Relation{} = rel, state) do
    state = Map.update!(state, :relations, &Map.put(&1, rel.id, rel))
    {:noreply, [], state}
  end

  defp process_message(%Insert{} = msg, %State{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    new_record = %NewRecord{relation: {relation.namespace, relation.name}, record: data}

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [new_record | txn.changes]}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  defp process_message(%Update{} = msg, %State{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    old_data = data_tuple_to_map(relation.columns, msg.old_tuple_data)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    updated_record =
      UpdatedRecord.new(
        relation: {relation.namespace, relation.name},
        old_record: old_data,
        record: data
      )

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [updated_record | txn.changes]}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  defp process_message(%Delete{} = msg, %State{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    data =
      data_tuple_to_map(
        relation.columns,
        msg.old_tuple_data || msg.changed_key_tuple_data
      )

    deleted_record = %DeletedRecord{
      relation: {relation.namespace, relation.name},
      old_record: data
    }

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [deleted_record | txn.changes]}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  defp process_message(%Truncate{} = msg, state) do
    truncated_relations =
      for truncated_relation <- msg.truncated_relations do
        relation = Map.get(state.relations, truncated_relation)

        %TruncatedRelation{
          relation: {relation.namespace, relation.name}
        }
      end

    {lsn, txn} = state.transaction
    txn = %{txn | changes: Enum.reverse(truncated_relations) ++ txn.changes}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  # When we have a new event, enqueue it and see if there's any
  # pending demand we can meet by dispatching events.

  defp process_message(
         %Commit{lsn: commit_lsn, end_lsn: end_lsn},
         %State{transaction: {current_txn_lsn, txn}, queue: queue} = state
       )
       when commit_lsn == current_txn_lsn do
    event =
      txn
      |> ShadowTableTransformation.enrich_tx_from_shadow_ops()
      |> build_message(end_lsn, state)

    Metrics.span_event(state.span, :transaction, Transaction.count_operations(event))

    queue = :queue.in(event, queue)
    state = %{state | queue: queue, transaction: nil}

    state
    |> advance_main_slot(end_lsn)
    |> dispatch_events([])
  end

  # When we have new demand, add it to any pending demand and see if we can
  # meet it by dispatching events.
  @impl true
  def handle_demand(incoming_demand, %{demand: pending_demand} = state) do
    state = %{state | demand: incoming_demand + pending_demand}

    dispatch_events(state, [])
  end

  # When we're done exhausting demand, emit events.
  defp dispatch_events(%{demand: 0} = state, events) do
    emit_events(state, events)
  end

  defp dispatch_events(%{demand: demand, queue: queue} = state, events) do
    case :queue.out(queue) do
      # If the queue has events, recurse to accumulate them
      # as long as there is demand.
      {{:value, event}, queue} ->
        state = %{state | demand: demand - 1, queue: queue}

        dispatch_events(state, [event | events])

      # When the queue is empty, emit any accumulated events.
      {:empty, queue} ->
        state = %{state | queue: queue}

        emit_events(state, events)
    end
  end

  defp emit_events(state, []) do
    {:noreply, [], state}
  end

  defp emit_events(state, events) do
    {:noreply, Enum.reverse(events), state}
  end

  @spec data_tuple_to_map([Relation.Column.t()], list()) :: term()
  defp data_tuple_to_map(_columns, nil), do: %{}

  defp data_tuple_to_map(columns, tuple_data) do
    columns
    |> Enum.zip(tuple_data)
    |> Map.new(fn {column, data} -> {column.name, data} end)
  end

  defp build_message(%Transaction{} = transaction, end_lsn, %State{} = state) do
    conn = state.conn
    origin = state.origin

    %Transaction{
      transaction
      | lsn: end_lsn,
        # Make sure not to pass state.field into ack function, as this
        # will create a copy of the whole state in memory when sending a message
        ack_fn: fn -> ack(conn, origin, end_lsn) end
    }
  end

  @spec ack(pid(), Connectors.origin(), Lsn.t()) :: :ok
  def ack(conn, origin, lsn) do
    Logger.debug("Acknowledging #{lsn}", origin: origin)
    Client.acknowledge_lsn(conn, lsn)
  end

  # Advance the replication slot to let Postgres discard old WAL records.
  #
  # TODO: make sure we're not removing transactions that are about to be requested by a newly
  # connected client. See VAX-1552.
  #
  # TODO(optimization): do not run this after every consumed transaction.
  defp advance_main_slot(state, end_lsn) do
    min_in_window_lsn = Lsn.increment(end_lsn, -state.resumable_wal_window)

    if Lsn.compare(state.main_slot_lsn, min_in_window_lsn) == :lt do
      :ok =
        Client.with_conn(state.conn_opts, fn conn ->
          Client.advance_replication_slot(conn, state.main_slot, min_in_window_lsn)
        end)

      %{state | main_slot_lsn: min_in_window_lsn}
    else
      state
    end
  end
end
