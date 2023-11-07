defmodule Electric.Replication.Postgres.LogicalReplicationProducer do
  use GenStage
  require Logger

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
    TruncatedRelation
  }

  defmodule State do
    defstruct conn: nil,
              demand: 0,
              queue: nil,
              relations: %{},
              transaction: nil,
              publication: nil,
              client: nil,
              origin: nil,
              drop_current_transaction?: false,
              types: %{},
              ignored_relations: MapSet.new(),
              span: nil

    @type t() :: %__MODULE__{
            conn: pid(),
            demand: non_neg_integer(),
            queue: :queue.queue(),
            relations: %{Messages.relation_id() => %Relation{}},
            transaction: {Electric.Postgres.Lsn.t(), %Transaction{}},
            publication: String.t(),
            origin: Connectors.origin(),
            drop_current_transaction?: boolean(),
            types: %{},
            ignored_relations: MapSet.t(),
            span: Metrics.t() | nil
          }
  end

  @spec start_link(Connectors.config()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(conn_config) do
    GenStage.start_link(__MODULE__, conn_config)
  end

  @spec get_name(Connectors.origin()) :: Electric.reg_name()
  def get_name(name) do
    {:via, :gproc, name(name)}
  end

  defp name(name) do
    {:n, :l, {__MODULE__, name}}
  end

  @impl true
  def init(conn_config) do
    origin = Connectors.origin(conn_config)
    conn_opts = Connectors.get_connection_opts(conn_config, replication: true)
    repl_opts = Connectors.get_replication_opts(conn_config)

    :gproc.reg(name(origin))

    publication = repl_opts.publication
    slot = repl_opts.slot

    Logger.debug("#{__MODULE__} init:: publication: '#{publication}', slot: '#{slot}'")

    with {:ok, conn} <- Client.connect(conn_opts),
         {:ok, _} <- Client.create_slot(conn, slot),
         :ok <- Client.set_display_settings_for_replication(conn),
         {:ok, {short, long, cluster}} <- Client.get_server_versions(conn),
         {:ok, table_count} <- SchemaLoader.count_electrified_tables({SchemaCache, origin}),
         :ok <- Client.start_replication(conn, publication, slot, self()) do
      Process.monitor(conn)

      Logger.metadata(pg_producer: origin)
      Logger.info("Starting replication from #{origin}")
      Logger.info("Connection settings: #{inspect(conn_opts)}")

      span =
        Metrics.start_span([:postgres, :replication_from], %{electrified_tables: table_count}, %{
          cluster: cluster,
          short_version: short,
          long_version: long
        })

      {:producer,
       %State{
         conn: conn,
         queue: :queue.new(),
         publication: publication,
         origin: origin,
         span: span
       }}
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

  defp process_message(%Message{} = msg, state) do
    Logger.info("Got a message: #{inspect(msg)}")

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
    state =
      state
      |> maybe_ignore_relation(rel)
      |> Map.update!(:relations, &Map.put(&1, rel.id, rel))

    {:noreply, [], state}
  end

  defp process_message(%Insert{} = msg, %State{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    new_record = %NewRecord{relation: {relation.namespace, relation.name}, record: data}

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [new_record | txn.changes]}

    {:noreply, [],
     %{
       state
       | transaction: {lsn, txn},
         drop_current_transaction?: maybe_drop(msg.relation_id, state)
     }}
  end

  defp process_message(%Update{} = msg, %State{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    old_data = data_tuple_to_map(relation.columns, msg.old_tuple_data)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    updated_record = %UpdatedRecord{
      relation: {relation.namespace, relation.name},
      old_record: old_data,
      record: data
    }

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [updated_record | txn.changes]}

    {:noreply, [],
     %{
       state
       | transaction: {lsn, txn},
         drop_current_transaction?: maybe_drop(msg.relation_id, state)
     }}
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

    {:noreply, [],
     %{
       state
       | transaction: {lsn, txn},
         drop_current_transaction?: maybe_drop(msg.relation_id, state)
     }}
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
         %Commit{lsn: commit_lsn},
         %State{transaction: {current_txn_lsn, txn}, drop_current_transaction?: true} = state
       )
       when commit_lsn == current_txn_lsn do
    Logger.debug(
      "ignoring transaction with lsn #{inspect(commit_lsn)} and contents: #{inspect(txn)}"
    )

    {:noreply, [], %{state | transaction: nil, drop_current_transaction?: false}}
  end

  defp process_message(
         %Commit{lsn: commit_lsn, end_lsn: end_lsn},
         %State{transaction: {current_txn_lsn, txn}, queue: queue} = state
       )
       when commit_lsn == current_txn_lsn do
    event =
      txn
      |> Electric.Postgres.ShadowTableTransformation.enrich_tx_from_shadow_ops()
      |> build_message(end_lsn, state)

    Metrics.span_event(state.span, :transaction, Transaction.count_operations(event))

    queue = :queue.in(event, queue)
    state = %{state | queue: queue, transaction: nil, drop_current_transaction?: false}

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

  @spec ack(pid(), Connectors.origin(), Electric.Postgres.Lsn.t()) :: :ok
  def ack(conn, origin, lsn) do
    Logger.debug("Acknowledging #{lsn}", origin: origin)
    Client.acknowledge_lsn(conn, lsn)
  end

  # Limit replication of electric.* tables since they are not expected to be
  # replicated further from PG.
  defp maybe_ignore_relation(state, %Relation{} = rel) do
    # We do not encourage developers to use 'electric' schema, but some
    # tools like sysbench do that by default, instead of 'public' schema
    if rel.id in state.ignored_relations or
         (rel.namespace == "electric" and rel.name in ["migrations", "meta"]) do
      update_in(state.ignored_relations, &MapSet.put(&1, rel.id))
    else
      state
    end
  end

  @spec maybe_drop(Messages.relation_id(), %State{}) :: boolean
  defp maybe_drop(_rel_id, %State{drop_current_transaction?: true}) do
    true
  end

  defp maybe_drop(rel_id, %State{ignored_relations: rel_ids}) do
    rel_id in rel_ids
  end
end
