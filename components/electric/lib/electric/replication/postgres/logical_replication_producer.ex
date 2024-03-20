defmodule Electric.Replication.Postgres.LogicalReplicationProducer do
  use GenStage

  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Telemetry.Metrics

  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.Lsn

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client
  alias Electric.Replication.Postgres.LogicalMessages

  require Logger

  defmodule State do
    defstruct repl_conn: nil,
              svc_conn: nil,
              demand: 0,
              queue: :queue.new(),
              queue_len: 0,
              relations: %{},
              transaction: nil,
              replication_context: %LogicalMessages.Context{},
              client: nil,
              origin: nil,
              publication: nil,
              types: %{},
              span: nil,
              advance_timer: nil,
              main_slot: "",
              main_slot_lsn: %Lsn{},
              reservations: %{},
              resumable_wal_window: 1

    @type t() :: %__MODULE__{
            repl_conn: pid(),
            svc_conn: pid(),
            demand: non_neg_integer(),
            queue: :queue.queue(),
            queue_len: non_neg_integer(),
            relations: %{Messages.relation_id() => %Relation{}},
            transaction: {Lsn.t(), %Transaction{}},
            replication_context: LogicalMessages.Context.t(),
            origin: Connectors.origin(),
            publication: binary(),
            types: %{},
            span: Metrics.t() | nil,
            advance_timer: reference() | nil,
            main_slot: binary(),
            main_slot_lsn: Lsn.t(),
            reservations: %{binary() => {Api.wal_pos(), integer() | nil}},
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

  def reserve_wal_lsn(origin, client_id, client_lsn) do
    # Sanity check to make sure client is not "in the future" relative to the latest Postgres
    # state.
    if Lsn.compare(client_lsn, current_lsn(origin)) != :gt do
      GenStage.call(name(origin), {:reserve_wal_lsn, client_id, client_lsn})
    else
      :error
    end
  end

  def cancel_reservation(origin, client_id) do
    GenStage.cast(name(origin), {:cancel_reservation, client_id})
  end

  @impl true
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    conn_opts = Connectors.get_connection_opts(connector_config)
    repl_conn_opts = Connectors.get_connection_opts(connector_config, replication: true)
    repl_opts = Connectors.get_replication_opts(connector_config)
    wal_window_opts = Connectors.get_wal_window_opts(connector_config)

    publication = repl_opts.publication
    main_slot = repl_opts.slot
    tmp_slot = main_slot <> "_rc"

    Logger.metadata(pg_producer: origin)

    Logger.info(
      "Starting replication with publication=#{publication} and slots=#{main_slot},#{tmp_slot}}"
    )

    # The replication connection is used to consumer the logical replication stream from
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
         :ok <- Client.set_display_settings_for_replication(repl_conn),
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
          queue: :queue.new(),
          origin: origin,
          publication: publication,
          replication_context: %LogicalMessages.Context{
            origin: origin,
            publication: publication
          },
          span: span,
          main_slot: main_slot,
          main_slot_lsn: main_slot_lsn,
          resumable_wal_window: wal_window_opts.resumable_size
        }
        |> reset_replication_context()
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

  defp reset_replication_context(state) do
    update_in(state.replication_context, &LogicalMessages.Context.reset_tx/1)
  end

  defp schedule_main_slot_advance(state) do
    tref = :erlang.start_timer(@advance_timeout, self(), @advance_msg)
    %State{state | advance_timer: tref}
  end

  @impl true
  def terminate(_reason, state) do
    Metrics.stop_span(state.span)
  end

  @impl true
  def handle_call({:reserve_wal_lsn, client_id, client_lsn}, _from, state) do
    if Lsn.compare(client_lsn, state.main_slot_lsn) == :lt do
      {:reply, :error, [], state}
    else
      state = Map.update!(state, :reservations, &Map.put(&1, client_id, {client_lsn, nil}))
      {:reply, :ok, [], state}
    end
  end

  @impl true
  def handle_cast({:cancel_reservation, client_id}, %{reservations: reservations} = state) do
    reservations = Map.delete(reservations, client_id)
    {:noreply, [], %{state | reservations: reservations}}
  end

  @impl true
  def handle_info({:epgsql, _pid, {:x_log_data, _start_lsn, _end_lsn, binary_msg}}, state) do
    context =
      binary_msg
      |> LogicalReplication.decode_message()
      |> LogicalMessages.process(state.replication_context)

    case context.transaction do
      nil ->
        {:noreply, [], %{state | replication_context: context}}

      %Transaction{} = tx ->
        # When we have a new transaction, enqueue it and see if there's any
        # pending demand we can meet by dispatching events.
        enqueue_transaction(tx, state)
    end
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
    queue |> :queue.last() |> ack(state)

    state = %{state | queue: :queue.new(), queue_len: 0, demand: demand - queue_len}
    {:noreply, :queue.to_list(queue), state}
  end

  defp dispatch_events(%{demand: demand, queue: queue, queue_len: queue_len} = state) do
    {to_emit, queue_remaining} = :queue.split(demand, queue)
    to_emit |> :queue.last() |> ack(state)

    state = %{state | queue: queue_remaining, queue_len: queue_len - demand, demand: 0}
    {:noreply, :queue.to_list(to_emit), state}
  end

  @spec ack(Transaction.t(), State.t()) :: :ok

  if Mix.env() == :test do
    def ack(%Transaction{}, %State{repl_conn: :conn}) do
      :ok
    end
  end

  def ack(%Transaction{lsn: lsn}, state) do
    Logger.debug("Acknowledging #{lsn}", origin: state.origin)
    Client.acknowledge_lsn(state.repl_conn, lsn)
  end

  defp enqueue_transaction(%Transaction{} = tx, %State{} = state) do
    Metrics.span_event(state.span, :transaction, Transaction.count_operations(tx))

    %{state | queue: :queue.in(tx, state.queue, queue_len: state.queue_len + 1)}
    |> reset_replication_context()
    |> advance_main_slot(tx.lsn)
    |> dispatch_events()
  end

  # Advance the replication slot to let Postgres discard old WAL records.
  #
  # TODO: make sure we're not removing transactions that are about to be requested by a newly
  # connected client. See VAX-1552.
  #
  # TODO(optimization): do not run this after every consumed transaction.
  defp advance_main_slot(state, end_lsn) do
    min_in_window_lsn = Lsn.increment(end_lsn, -state.resumable_wal_window)
    min_lsn_to_keep = Enum.min([min_in_window_lsn, min_reserved_lsn(state)], Lsn)

    if Lsn.compare(state.main_slot_lsn, min_lsn_to_keep) == :lt do
      # The sliding window that has the size `state.resumable_wal_window` and ends at
      # `end_lsn` has moved forward. Advance the replication slot's starting point to let
      # Postgres discard older WAL records.
      :ok = Client.advance_replication_slot(state.svc_conn, state.main_slot, min_lsn_to_keep)
      %{state | main_slot_lsn: min_lsn_to_keep}
    else
      state
    end
  end

  defp min_reserved_lsn(%{reservations: reservations}) when map_size(reservations) == 0, do: nil

  defp min_reserved_lsn(%{reservations: reservations}) do
    reservations |> Enum.min_by(fn {_client_id, lsn} -> lsn end, Lsn) |> elem(1)
  end
end
