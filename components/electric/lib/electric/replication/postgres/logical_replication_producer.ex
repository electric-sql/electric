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
    defstruct repl_conn: nil,
              svc_conn: nil,
              demand: 0,
              queue: :queue.new(),
              queue_len: 0,
              relations: %{},
              transaction: nil,
              publication: nil,
              client: nil,
              origin: nil,
              types: %{},
              span: nil,
              advance_timer: nil,
              main_slot: "",
              main_slot_lsn: %Lsn{},
              acked_lsn: %Lsn{},
              resumable_wal_window: 1

    @type t() :: %__MODULE__{
            repl_conn: pid(),
            svc_conn: pid(),
            demand: non_neg_integer(),
            queue: :queue.queue(),
            queue_len: non_neg_integer(),
            relations: %{Messages.relation_id() => %Relation{}},
            transaction: {Lsn.t(), %Transaction{}},
            publication: binary(),
            origin: Connectors.origin(),
            types: %{},
            span: Metrics.t() | nil,
            advance_timer: reference() | nil,
            main_slot: binary(),
            main_slot_lsn: Lsn.t(),
            acked_lsn: Lsn.t(),
            resumable_wal_window: pos_integer()
          }
  end

  # How often to check whether the the replication slot needs to be advanced, in milliseconds.
  #
  # 30 seconds is long enough to not put any noticeable load on the database and short enough
  # for Postgres to discard obsolete WAL records such that disk usage metrics remain constant
  # once the configured limit of the resumable WAL window is reached.
  @advance_timeout 30_000
  @advance_msg :advance_main_slot

  if Mix.env() == :test do
    @advance_timeout 1_000
  end

  # 100 MB is somewhat arbitrary, chosen to balance between the frequency of acks and extra
  # disk usage.
  @active_slot_lag_bytes 100 * 1024 * 1024

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
    conn_opts = Connectors.get_connection_opts(connector_config)
    repl_conn_opts = Connectors.get_connection_opts(connector_config, replication: true)
    repl_opts = Connectors.get_replication_opts(connector_config)
    wal_window_opts = Connectors.get_wal_window_opts(connector_config)
    Process.set_label({:logical_replication, origin})

    publication = repl_opts.publication
    main_slot = repl_opts.slot
    # Ensure temporary slot name fits within Postgres' limit of 63 chars
    tmp_slot = String.slice(main_slot, 0..59) <> "_rc"

    Logger.metadata(pg_producer: origin)

    Logger.info(
      "Starting replication with publication=#{publication} and slots=#{main_slot},#{tmp_slot}}"
    )

    # The replication connection is used to consume the logical replication stream from
    # Postgres and to send acknowledgements about received transactions back to Postgres,
    # allowing it to advance the replication slot forward and discard obsolete WAL records.
    with {:ok, repl_conn} <- Client.connect(repl_conn_opts),
         # Refactoring note: make sure that both slots are created first thing after a
         # connection is opened. In particular, trying to call `Client.get_server_versions()` before
         # creating the main slot results in the replication stream not delivering transactions from
         # Postgres when Electric is running in the direct_writes mode, which manifests as a
         # failure of e2e/tests/02.02_migrations_get_streamed_to_satellite.lux.
         {:ok, _slot_name} <- Client.create_main_slot(repl_conn, main_slot),
         {:ok, _slot_name, main_slot_lsn} <-
           Client.create_temporary_slot(repl_conn, main_slot, tmp_slot),
         {:ok, {short, long, cluster}} <- Client.get_server_versions(repl_conn),
         {:ok, table_count} <- SchemaLoader.count_electrified_tables({SchemaCache, origin}),
         {:ok, current_lsn} <- Client.current_lsn(repl_conn),
         start_lsn = start_lsn(main_slot_lsn, current_lsn, wal_window_opts),
         :ok <- Client.start_replication(repl_conn, publication, tmp_slot, start_lsn, self()),
         # The service connection is opened alongside the replication connection to execute
         # maintenance statements. It is needed because Postgres does not allow regular
         # statements and queries on a replication connection once the replication has started.
         {:ok, svc_conn} <- Client.connect(conn_opts) do
      # Monitor the connection process to know when to stop the telemetry span created on the next line.
      Process.monitor(repl_conn)

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
          publication: publication,
          origin: origin,
          span: span,
          main_slot: main_slot,
          main_slot_lsn: main_slot_lsn,
          resumable_wal_window: wal_window_opts.resumable_size
        }
        # The replication slot used by the replication connection prevents Postgres from
        # discarding WAL records created after slot's start LSN.  Any writes in Postgres cause
        # the WAL to grow, and, moreover, managed Postgres instances from any provider exhibit
        # some background write rate even when the user application is idle. To keep WAL's disk
        # usage in check, we perform a periodic check to see if the total WAL size kept around
        # by our replication slot has exceeded the configured limit.
        |> schedule_main_slot_advance()

      {:producer, state}
    end
  end

  # The current implementation is trivial for one reason: we don't know how many transactions
  # that touch electrified tables ("etxns" from now on) there are between `main_slot_lsn` and
  # `current_lsn`. As an extreme example, there could be one such transaction among thousands
  # of transactions that Electric won't see. So there's no sensible way of choosing the start LSN
  # such that we would stream in precisely as many etxns as can fit into the in-memory cache.
  #
  # Right now, the only way to preload all recent etxns into memory is to start streaming from
  # the slot's starting point and rely on the in-memory cache's garbage collection to discard
  # old transactions when it overflows.
  #
  # Going forward, we should look into writing etxns to a custom file format on disk as we
  # are reading them from the logical replication stream. That will allow us to start
  # replication from the last observed LSN, stream transactions until we reach the current LSN
  # in Postgres and then fill the remaining cache space with older transactions from the file
  # on disk.
  defp start_lsn(main_slot_lsn, _current_lsn, _wal_window_opts) do
    main_slot_lsn
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

  def handle_info({:timeout, tref, @advance_msg}, %State{advance_timer: tref} = state) do
    {:noreply, [], state |> advance_main_slot() |> schedule_main_slot_advance()}
  end

  def handle_info(msg, state) do
    Logger.debug("Unexpected message #{inspect(msg)}")
    {:noreply, [], state}
  end

  defp process_message(
         %Message{transactional?: true, prefix: "electric.fk_chain_touch", content: content} =
           msg,
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

    state = ack_message(msg, state)

    {lsn, txn} = state.transaction

    {:noreply, [],
     %{state | transaction: {lsn, Transaction.add_referenced_record(txn, referenced)}}}
  end

  defp process_message(%Message{} = msg, state) do
    Logger.info("Got a message from PG via logical replication: #{inspect(msg)}")
    state = ack_message(msg, state)
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
      %{txn | lsn: end_lsn}
      |> ShadowTableTransformation.enrich_tx_from_shadow_ops()

    Metrics.span_event(state.span, :transaction, Transaction.count_operations(event))

    queue = :queue.in(event, queue)
    state = %{state | queue: queue, queue_len: state.queue_len + 1, transaction: nil}

    dispatch_events(state)
  end

  # When we have new demand, add it to any pending demand and see if we can
  # meet it by dispatching events.
  @impl true
  def handle_demand(incoming_demand, %{demand: pending_demand} = state) do
    state = %{state | demand: incoming_demand + pending_demand}

    dispatch_events(state)
  end

  defp dispatch_events(%{demand: demand, queue_len: queue_len} = state)
       when demand == 0 or queue_len == 0 do
    {:noreply, [], state}
  end

  defp dispatch_events(%{demand: demand, queue: queue, queue_len: queue_len} = state)
       when demand >= queue_len do
    state = queue |> :queue.last() |> ack_transaction(state)
    state = %{state | queue: :queue.new(), queue_len: 0, demand: demand - queue_len}
    {:noreply, :queue.to_list(queue), state}
  end

  defp dispatch_events(%{demand: demand, queue: queue, queue_len: queue_len} = state) do
    {to_emit, queue_remaining} = :queue.split(demand, queue)
    state = to_emit |> :queue.last() |> ack_transaction(state)
    state = %{state | queue: queue_remaining, queue_len: queue_len - demand, demand: 0}
    {:noreply, :queue.to_list(to_emit), state}
  end

  @spec data_tuple_to_map([Relation.Column.t()], list()) :: term()
  defp data_tuple_to_map(_columns, nil), do: %{}

  defp data_tuple_to_map(columns, tuple_data) do
    columns
    |> Enum.zip(tuple_data)
    |> Map.new(fn {column, data} -> {column.name, data} end)
  end

  @spec ack_message(Message.t(), State.t()) :: State.t()

  if Mix.env() == :test do
    def ack_message(_, %State{repl_conn: :conn} = state), do: state
  end

  def ack_message(%Message{lsn: lsn}, state) do
    cond do
      state.queue_len > 0 ->
        # We still have unacknowledged transactions waiting in the queue. Can't acknowledge the
        # message before all transactions in the queue have been processed.
        state

      Lsn.compare(lsn, state.acked_lsn) != :gt ->
        # Either lsn == state.acked_lsn, in which case we can skip acknowledging it for the second time,
        # or lsn < state.acked_lsn, which could mean that the message's LSN is lower than the
        # LSN of the transaction it was emitted from or another transaction with a higher LSN
        # has already been acknowledged.
        state

      true ->
        ack_lsn(lsn, state)
    end
  end

  @spec ack_transaction(Transaction.t(), State.t()) :: State.t()

  if Mix.env() == :test do
    def ack_transaction(_, %State{repl_conn: :conn} = state), do: state
  end

  def ack_transaction(%Transaction{lsn: lsn}, state) do
    ack_lsn(lsn, state)
  end

  def ack_lsn(%Lsn{} = lsn, state) do
    assert_lsn_is_advancing!(lsn, state.acked_lsn, Lsn.compare(lsn, state.acked_lsn))

    Logger.debug("Acknowledging #{lsn}", origin: state.origin)
    :ok = Client.acknowledge_lsn(state.repl_conn, lsn)
    %{state | acked_lsn: lsn}
  end

  defp assert_lsn_is_advancing!(_lsn, _acked_lsn, :gt), do: :ok

  # Advance the replication slot to let Postgres discard old WAL records.
  #
  # TODO: make sure we're not removing transactions that are about to be requested by a newly
  # connected client. See VAX-1552.
  defp advance_main_slot(state) do
    {:ok, current_lsn} = Client.current_lsn(state.svc_conn)

    check_active_slot_lag(current_lsn, state)

    min_in_window_lsn = Lsn.increment(current_lsn, -state.resumable_wal_window)

    if Lsn.compare(state.main_slot_lsn, min_in_window_lsn) == :lt do
      # The sliding window that has the size `state.resumable_wal_window` and ends at
      # `current_lsn` has moved forward. Advance the replication slot's starting point to let
      # Postgres discard older WAL records.
      :ok = Client.advance_replication_slot(state.svc_conn, state.main_slot, min_in_window_lsn)
      %{state | main_slot_lsn: min_in_window_lsn}
    else
      state
    end
  end

  defp check_active_slot_lag(current_lsn, state) do
    lsn_threshold = Lsn.increment(current_lsn, -@active_slot_lag_bytes)

    if Lsn.compare(state.acked_lsn, lsn_threshold) == :lt do
      # If there's more than `@active_slot_lag_bytes` between the current LSN and the last
      # ack'ed LSN, emit a logical message to be consumed by the producer in order to advance
      # the active slot and prevent it from stalling removal of old WAL records by Postgres.
      :ok = Client.emit_logical_message(state.svc_conn, "advance active slot")
    end
  end

  defp schedule_main_slot_advance(state) do
    tref = :erlang.start_timer(@advance_timeout, self(), @advance_msg)
    %State{state | advance_timer: tref}
  end
end
