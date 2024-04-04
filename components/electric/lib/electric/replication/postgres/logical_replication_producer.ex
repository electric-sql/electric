defmodule Electric.Replication.Postgres.LogicalReplicationProducer do
  use GenStage
  require Logger

  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Telemetry.Metrics

  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.LogicalReplication.Messages
  alias Electric.Replication.Postgres.Client
  alias Electric.Replication.Connectors

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

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation,
    ReferencedRecord
  }

  defmodule State do
    defstruct repl_conn: nil,
              svc_conn: nil,
              demand: 0,
              queue: nil,
              relations: %{},
              transaction: nil,
              publication: nil,
              client: nil,
              origin: nil,
              types: %{},
              span: nil,
              magic_write_timer: nil

    @type t() :: %__MODULE__{
            repl_conn: pid(),
            svc_conn: pid(),
            demand: non_neg_integer(),
            queue: :queue.queue(),
            relations: %{Messages.relation_id() => %Relation{}},
            transaction: {Electric.Postgres.Lsn.t(), %Transaction{}},
            publication: String.t(),
            origin: Connectors.origin(),
            types: %{},
            span: Metrics.t() | nil,
            magic_write_timer: reference() | nil
          }
  end

  # Period of magic writes, in milliseconds.
  #
  # 30 seconds is long enough to not put any noticeable load on the database and short enough
  # for Postgres to discard obsolete WAL records before they register on a disk usage chart
  # that can be displayed on a managed Postgres provider's dashboard.
  @magic_write_timeout 30_000
  @magic_write_msg :magic_write

  if Mix.env() == :test do
    @magic_write_timeout 1_000
  end

  @spec start_link(Connectors.config()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(connector_config) do
    GenStage.start_link(__MODULE__, connector_config)
  end

  @spec get_name(Connectors.origin()) :: Electric.reg_name()
  def get_name(name) do
    {:via, :gproc, name(name)}
  end

  defp name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  @impl true
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    conn_opts = Connectors.get_connection_opts(connector_config)
    repl_conn_opts = Connectors.get_connection_opts(connector_config, replication: true)
    repl_opts = Connectors.get_replication_opts(connector_config)

    :gproc.reg(name(origin))

    publication = repl_opts.publication
    slot = repl_opts.slot

    Logger.debug("#{__MODULE__}.init: publication: '#{publication}', slot: '#{slot}'")

    Logger.info("Starting replication from #{origin}")

    Logger.info(
      "#{inspect(__MODULE__)}.init(#{inspect(Client.sanitize_conn_opts(repl_conn_opts))})"
    )

    # The replication connection is used to consumer the logical replication stream from
    # Postgres and to send acknowledgements about received transactions back to Postgres,
    # allowing it to advance the replication slot forward and discard obsolete WAL records.
    with {:ok, repl_conn} <- Client.connect(repl_conn_opts),
         {:ok, _} <- Client.create_slot(repl_conn, slot),
         :ok <- Client.set_display_settings_for_replication(repl_conn),
         {:ok, {short, long, cluster}} <- Client.get_server_versions(repl_conn),
         {:ok, table_count} <- SchemaLoader.count_electrified_tables({SchemaCache, origin}),
         :ok <- Client.start_replication(repl_conn, publication, slot, self()),
         # The service connection is opened alongside the replication connection to execute
         # maintenance statements. It is needed because Postgres does not allow regular
         # statements and queries on a replication connection once the replication has started.
         {:ok, svc_conn} <- Client.connect(conn_opts) do
      Process.monitor(repl_conn)

      Logger.metadata(pg_producer: origin)

      span =
        Metrics.start_span([:postgres, :replication_from], %{electrified_tables: table_count}, %{
          cluster: cluster,
          short_version: short,
          long_version: long
        })

      state =
        %State{
          repl_conn: repl_conn,
          svc_conn: svc_conn,
          queue: :queue.new(),
          publication: publication,
          origin: origin,
          span: span
        }
        # The replication slot used by the replication connection prevents Postgres from
        # discarding old WAL records until Electric sees a write to an electrified table.
        # However, any writes in Postgres cause the WAL to grow, and, moreover, managed
        # Postgres instances from any provider exhibit some background write rate even when the
        # user application is idle. To keep WAL's disk usage in check, we issue a periodic no-op
        # write that gets delivered to Electric over the replications stream, allowing it to
        # ack the latest WAL position and let Postgres discard older records.
        |> schedule_magic_write()

      {:producer, state}
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

  def handle_info({:DOWN, _, :process, conn, reason}, %State{repl_conn: conn} = state) do
    Logger.warning("PostgreSQL closed the replication connection")
    Metrics.stop_span(state.span)
    {:stop, reason, state}
  end

  def handle_info({:DOWN, _, :process, conn, reason}, %State{svc_conn: conn} = state) do
    Logger.warning("PostgreSQL closed the persistent connection")
    Metrics.stop_span(state.span)
    {:stop, reason, state}
  end

  def handle_info({:timeout, tref, @magic_write_msg}, %State{magic_write_timer: tref} = state) do
    marker = "postgres_replication_producer:#{System.monotonic_time()}"
    Electric.Replication.InitialSync.perform_magic_write(state.svc_conn, marker)
    {:noreply, [], schedule_magic_write(%State{state | magic_write_timer: nil})}
  end

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

    dispatch_events(state, [])
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
    repl_conn = state.repl_conn
    origin = state.origin

    %Transaction{
      transaction
      | lsn: end_lsn,
        # Make sure not to pass state.field into ack function, as this
        # will create a copy of the whole state in memory when sending a message
        ack_fn: fn -> ack(repl_conn, origin, end_lsn) end
    }
  end

  @spec ack(pid(), Connectors.origin(), Electric.Postgres.Lsn.t()) :: :ok
  def ack(repl_conn, origin, lsn) do
    Logger.debug("Acknowledging #{lsn}", origin: origin)
    Client.acknowledge_lsn(repl_conn, lsn)
  end

  defp schedule_magic_write(state) do
    tref = :erlang.start_timer(@magic_write_timeout, self(), @magic_write_msg)
    %State{state | magic_write_timer: tref}
  end
end
