defmodule Electric.Replication.Postgres.LogicalReplicationProducer do
  use GenStage

  alias Electric.Postgres.ShadowTableTransformation
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
    defstruct conn: nil,
              conn_opts: %{},
              demand: 0,
              queue: nil,
              replication_context: %LogicalMessages.Context{},
              client: nil,
              origin: nil,
              publication: nil,
              types: %{},
              span: nil,
              main_slot: "",
              main_slot_lsn: %Lsn{},
              current_lsn: %Lsn{},
              resumable_wal_window: 1

    @type t() :: %__MODULE__{
            conn: pid(),
            conn_opts: Connectors.connection_opts(),
            demand: non_neg_integer(),
            queue: :queue.queue(),
            replication_context: LogicalMessages.Context.t(),
            origin: Connectors.origin(),
            publication: binary(),
            types: %{},
            span: Metrics.t() | nil,
            main_slot: binary(),
            main_slot_lsn: Lsn.t(),
            current_lsn: Lsn.t(),
            resumable_wal_window: pos_integer()
          }
  end

  @current_lsn_key :current_lsn

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

  @spec current_lsn(Connectors.origin()) :: Lsn.t()
  def current_lsn(origin) do
    :ets.lookup_element(ets_table_name(origin), @current_lsn_key, 2)
  end

  @impl true
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    conn_opts = Connectors.get_connection_opts(connector_config, replication: true)
    repl_opts = Connectors.get_replication_opts(connector_config)
    wal_window_opts = Connectors.get_wal_window_opts(connector_config)

    :ets.new(ets_table_name(origin), [:protected, :named_table, read_concurrency: true])

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
      # Monitor the connection process to know when to stop the telemetry span created on the next line.
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
       |> set_current_lsn(current_lsn)}
    end
  end

  defp ets_table_name(origin) do
    String.to_atom(inspect(__MODULE__) <> ":" <> origin)
  end

  defp reset_replication_context(state) do
    update_in(state.replication_context, &LogicalMessages.Context.reset_tx/1)
  end

  defp set_current_lsn(state, lsn) do
    :ets.insert(ets_table_name(state.origin), {@current_lsn_key, lsn})
    %{state | current_lsn: lsn}
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
        tx = finalize_transaction(tx, state)
        enqueue_transaction(tx, state)
    end
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

  # When we have new demand, add it to any pending demand and see if we can
  # meet it by dispatching events.
  @impl true
  def handle_demand(incoming_demand, %{demand: pending_demand} = state) do
    %{state | demand: incoming_demand + pending_demand}
    |> dispatch_events([])
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
        %{state | demand: demand - 1, queue: queue}
        |> dispatch_events([event | events])

      # When the queue is empty, emit any accumulated events.
      {:empty, queue} ->
        %{state | queue: queue}
        |> emit_events(events)
    end
  end

  defp emit_events(state, []) do
    {:noreply, [], state}
  end

  defp emit_events(state, events) do
    {:noreply, Enum.reverse(events), state}
  end

  defp finalize_transaction(%Transaction{} = tx, %State{} = state) do
    # Make sure not to pass state.field into ack function, as this
    # would create a copy of the whole state in memory when sending a message
    conn = state.conn
    origin = state.origin
    lsn = tx.lsn
    %{tx | ack_fn: fn -> ack(conn, origin, lsn) end}
  end

  @spec ack(pid(), Connectors.origin(), Lsn.t()) :: :ok
  def ack(conn, origin, lsn) do
    Logger.debug("Acknowledging #{lsn}", origin: origin)
    Client.acknowledge_lsn(conn, lsn)
  end

  defp enqueue_transaction(%Transaction{} = tx, %State{} = state) do
    Metrics.span_event(state.span, :transaction, Transaction.count_operations(tx))

    %{state | queue: :queue.in(tx, state.queue)}
    |> reset_replication_context()
    |> set_current_lsn(tx.lsn)
    |> advance_main_slot()
    |> dispatch_events([])
  end

  # Advance the replication slot to let Postgres discard old WAL records.
  #
  # TODO: make sure we're not removing transactions that are about to be requested by a newly
  # connected client. See VAX-1552.
  #
  # TODO(optimization): do not run this after every consumed transaction.
  defp advance_main_slot(state) do
    min_in_window_lsn = Lsn.increment(state.current_lsn, -state.resumable_wal_window)

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
