defmodule Electric.Connection.Manager do
  @moduledoc """
  Custom initialisation and reconnection logic for database connections.

  This module is esentially a supervisor for database connections, implemented as a GenServer.
  Unlike an OTP process supervisor, it includes additional functionality:

    - adjusting connection options based on the response from the database
    - monitoring connections and initiating a reconnection procedure
    - custom reconnection logic with exponential backoff
    - starting the shape consumer supervisor tree once a database connection pool
      has been initialized

  Your OTP application should start a singleton connection manager under its main supervision tree:

      children = [
        ...,
        {Electric.Connection.Manager,
         stack_id: ...,
         connection_opts: [...],
         replication_opts: [...],
         pool_opts: [...],
         timeline_opts: [...],
         shape_cache_opts: [...]}
      ]

      Supervisor.start_link(children, strategy: :one_for_one)
  """

  # We model the connection manager as a state machine with 2 levels of state. On the 1st
  # level, it can be in one of several phases:
  #
  #   - :connection_setup
  #   - :running
  #   - :restarting_replication_client
  #
  # Connection manager starts in the :connection_setup phase and moves into the :running phase
  # after all processes have been started and the replication client is given the command to
  # start streaming.
  #
  # If at any point after that the replication client process exits, connection manager
  # transitions into the :restarting_replication_client phase and tries to restart the client.
  #
  # If any other connection process exits, connection manager itself will shut down to start
  # from scratch, as there could be too many failure states to address each one individually.
  #
  # The 2nd level of the state machine splits the current phase into a series of steps which
  # the process goes through until it finishes the connection setup phase and transitions into
  # the running phase.
  #
  # Function clauses match on the current phase and step as a way to both assert on the current
  # state as well as make the code more self-documenting.

  defmodule State do
    @type phase :: :connection_setup | :running | :restarting_replication_client
    @type step ::
            {:start_lock_connection, nil}
            | {:start_lock_connection, :connecting}
            | {:start_lock_connection, :acquiring_lock}
            # Steps that start with {:start_replication_client, ...} are pertinent to both the
            # :connection_setup phase and the :restarting_replication_client phase
            | {:start_replication_client, nil}
            | {:start_replication_client, :connecting}
            | {:start_replication_client, :configuring_connection}
            | :start_connection_pool
            | :start_shapes_supervisor
            | :waiting_for_consumers
            | {:start_replication_client, :start_streaming}
            # Steps of the :running phase:
            | :waiting_for_streaming_confirmation
            | :streaming

    defstruct [
      # The phase the connection manager is in. It defines which actions are taken if any of
      # the connection processes exit.
      :current_phase,
      # The current step defines what the connection manager does in the current phase and
      # which step will be taken next.
      :current_step,
      # Database connection opts to be passed to Postgrex modules
      :connection_opts,
      # Replication options specific to `Electric.Postgres.ReplicationClient`
      :replication_opts,
      # Connection options that are shared between regular connections and the replication
      # connection. If this is set to `nil` post-initialization, it means that regular
      # connections and the replication connection have been configured using different
      # connection URLs.
      :shared_connection_opts,
      # Database connection pool options
      :pool_opts,
      # Unique ref for matching on :connected and :disconnected events the connection pool
      :pool_ref,
      # Options specific to `Electric.Timeline`
      :timeline_opts,
      # Options passed to the Replication.Supervisor's start_link() function
      :shape_cache_opts,
      # PID of the replication client
      :replication_client_pid,
      # Timer reference for the periodic replication client status check
      :replication_client_timer,
      # This flag is set whenever the timer that checks the replication client's status trips
      # and the client still hasn't finished configuration its connection by then.
      :replication_client_blocked_by_pending_transaction?,
      # PID of the Postgres connection lock
      :lock_connection_pid,
      # Timer reference for the periodic lock status check
      :lock_connection_timer,
      # PID of the database connection pool
      :pool_pid,
      # PID of the shape log collector
      :shape_log_collector_pid,
      # Backoff term used for reconnection with exponential back-off
      :connection_backoff,
      # PostgreSQL server version
      :pg_version,
      # PostgreSQL system identifier
      :pg_system_identifier,
      # PostgreSQL timeline ID
      :pg_timeline_id,
      # ID used for process labeling and sibling discovery
      :stack_id,
      # Registry used for stack events
      :stack_events_registry,
      :tweaks,
      :persistent_kv,
      :purge_all_shapes?,
      drop_slot_requested: false
    ]
  end

  use GenServer, shutdown: :infinity
  alias Electric.Connection.Manager.ConnectionBackoff
  alias Electric.DbConnectionError
  alias Electric.StatusMonitor

  require Logger

  @type status :: :waiting | :starting | :active

  @type option ::
          {:stack_id, atom | String.t()}
          | {:connection_opts, Keyword.t()}
          | {:replication_opts, Keyword.t()}
          | {:pool_opts, Keyword.t()}
          | {:timeline_opts, Keyword.t()}
          | {:shape_cache_opts, Keyword.t()}

  @type options :: [option]

  @connection_status_check_interval 10_000

  # Time after establishing replication connection before we consider it successful
  # from a retrying perspective, to allow for setup errors sent over the stream
  # to be received. Any failure within this period will trigger a retry within
  # the same reconnection period rather than a new one.
  @replication_liveness_confirmation_duration 5_000

  def child_spec(init_arg) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [init_arg]},
      type: :supervisor
    }
  end

  @spec start_link(options) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
  end

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    name(Access.fetch!(opts, :stack_id))
  end

  @db_pool_ephemeral_module_name Electric.DbPool

  def pool_name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, @db_pool_ephemeral_module_name)
  end

  def pool_name(opts) do
    pool_name(Access.fetch!(opts, :stack_id))
  end

  def drop_replication_slot_on_stop(manager) do
    GenServer.cast(manager, :drop_replication_slot_on_stop)
  end

  def lock_connection_started(manager) do
    GenServer.cast(manager, :lock_connection_started)
  end

  def consumers_ready(stack_id) do
    GenServer.cast(name(stack_id), :consumers_ready)
  end

  def exclusive_connection_lock_acquisition_failed(manager, error) do
    GenServer.cast(manager, {:exclusive_connection_lock_acquisition_failed, error})
  end

  def exclusive_connection_lock_acquired(manager) do
    GenServer.cast(manager, :exclusive_connection_lock_acquired)
  end

  def replication_client_started(manager) do
    GenServer.cast(manager, :replication_client_started)
  end

  def replication_client_created_new_slot(manager) do
    GenServer.cast(manager, :replication_client_created_new_slot)
  end

  def replication_client_ready_to_stream(manager) do
    GenServer.cast(manager, :replication_client_ready_to_stream)
  end

  def replication_client_streamed_first_message(manager) do
    GenServer.cast(manager, :replication_client_streamed_first_message)
  end

  def pg_system_info_obtained(manager, system_info) do
    GenServer.cast(manager, {:pg_system_info_obtained, system_info})
  end

  def pg_info_obtained(manager, pg_info) do
    GenServer.cast(manager, {:pg_info_obtained, pg_info})
  end

  # Used for testing the responsiveness of the manager process
  def ping(manager, timeout \\ 1000) do
    GenServer.call(manager, :ping, timeout)
  end

  @impl true
  def init(opts) do
    # Connection processes that the manager starts all initialize asynchronously and so the way
    # the report errors back to the manager process is via exit signals. To keep the manager
    # process alive and able to correct those errors, it has to trap exits.
    Process.flag(:trap_exit, true)

    Process.set_label({:connection_manager, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])

    pool_opts = Keyword.fetch!(opts, :pool_opts)
    timeline_opts = Keyword.fetch!(opts, :timeline_opts)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)

    state =
      %State{
        current_phase: :connection_setup,
        current_step: {:start_lock_connection, nil},
        pool_opts: pool_opts,
        pool_ref: make_ref(),
        timeline_opts: timeline_opts,
        shape_cache_opts: shape_cache_opts,
        connection_backoff: {ConnectionBackoff.init(1000, 10_000), nil},
        stack_id: Keyword.fetch!(opts, :stack_id),
        stack_events_registry: Keyword.fetch!(opts, :stack_events_registry),
        tweaks: Keyword.fetch!(opts, :tweaks),
        persistent_kv: Keyword.fetch!(opts, :persistent_kv)
      }
      |> initialize_connection_opts(opts)

    # Try to acquire the connection lock on the replication slot
    # before starting shape and replication processes, to ensure
    # a single active sync service is connected to Postgres per slot.
    {:ok, state, {:continue, :start_lock_connection}}
  end

  defp initialize_connection_opts(state, opts) do
    in_connection_opts = Keyword.fetch!(opts, :connection_opts)
    in_replication_opts = Keyword.fetch!(opts, :replication_opts)

    # If we see that both top-level connection opts and replication connection opts have been
    # initialized from the same kwlist, we'll skip the extra work and only perform the no-ssl
    # and ipv4 fallbacks once.
    shared_connection_opts =
      if in_connection_opts == Keyword.fetch!(in_replication_opts, :connection_opts) do
        populate_connection_opts(in_connection_opts)
      end

    connection_opts =
      if is_nil(shared_connection_opts), do: populate_connection_opts(in_connection_opts)

    replication_opts =
      in_replication_opts
      |> Keyword.put(:start_streaming?, false)
      |> Keyword.put(:connection_manager, self())
      |> Keyword.update!(:connection_opts, fn in_connection_opts ->
        if is_nil(shared_connection_opts), do: populate_connection_opts(in_connection_opts)
      end)

    %{
      state
      | shared_connection_opts: shared_connection_opts,
        connection_opts: connection_opts,
        replication_opts: replication_opts
    }
  end

  @impl true
  def handle_continue(
        :start_lock_connection,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_lock_connection, _},
          lock_connection_pid: nil
        } = state
      ) do
    opts = [
      # Lock connection must be direct-to-database, hence no pooled connection opts here.
      connection_opts: replication_connection_opts(state),
      connection_manager: self(),
      lock_name: Keyword.fetch!(state.replication_opts, :slot_name),
      stack_id: state.stack_id
    ]

    # The lock connection process starts up quickly and then tries to open a database
    # connection asynchronously. The manager will be notified about the lock connection's
    # progress via the :lock_connection_started and :exclusive_connection_lock_acquired casts.
    {:ok, pid} = Electric.Postgres.LockConnection.start_link(opts)

    state = %{
      state
      | lock_connection_pid: pid,
        current_step: {:start_lock_connection, :connecting}
    }

    {:noreply, state}
  end

  def handle_continue(
        :start_replication_client,
        %State{
          current_phase: phase,
          current_step: {:start_replication_client, _},
          replication_client_pid: nil
        } = state
      )
      when phase in [:connection_setup, :restarting_replication_client] do
    opts = [
      replication_opts: replication_opts(state),
      connection_manager: self(),
      stack_id: state.stack_id
    ]

    action =
      case phase do
        :connection_setup -> "Starting"
        :restarting_replication_client -> "Restarting"
      end

    Logger.debug("#{action} replication client for stack #{state.stack_id}")

    # The replication client starts up quickly and then proceeds to asynchronously opening a
    # replication connection to the database and configuring it.
    # The manager will be notified about the replication client's progress via the
    # :replication_client_started and :replication_client_ready_to_stream casts.
    # If configured to start streaming immediately, the :replication_client_streamed_first_message
    # cast would follow soon afterwards.
    {:ok, pid} = Electric.Postgres.ReplicationClient.start_link(opts)

    state = %{
      state
      | replication_client_pid: pid,
        replication_client_blocked_by_pending_transaction?: false,
        current_step: {:start_replication_client, :connecting}
    }

    {:noreply, state}
  end

  def handle_continue(
        :start_connection_pool,
        %State{
          current_phase: :connection_setup,
          current_step: :start_connection_pool,
          pool_pid: nil
        } = state
      ) do
    pool_size = Keyword.get(state.pool_opts, :pool_size, 2)
    conn_opts = pooled_connection_opts(state) |> Electric.Utils.deobfuscate_password()

    pool_config =
      [
        # Disable automatic reconnection for pooled connections making them terminate on
        # error. This lets us observe connection errors by configuring the current process
        # as a connection listener in the pool.
        # The value for `max_restarts` is based on the pool size so the pool supervisor
        # doesn't shutdown unless all pooled connections fall into a restart loop within
        # the 5 second grace interval.
        backoff_type: :stop,
        max_restarts: pool_size * 3,
        max_seconds: 5,
        connection_listeners: {[self()], state.pool_ref},
        # Assume the manager connection might be pooled, so use unnamed prepared
        # statements to avoid issues with the pooler
        #
        # See https://hexdocs.pm/postgrex/0.19.3/readme.html#pgbouncer
        prepare: :unnamed
      ]

    {:ok, pool_pid} =
      Postgrex.start_link(pool_config ++ state.pool_opts ++ conn_opts)

    # NOTE(alco): We're jumping ahead of ourselves here a bit because at this point we don't
    # yet have a confirmation that the connection pool has succeeded in opening a database
    # connection. But since we already have a lock connection and a replication connection
    # open, it's likely the connection pool will also succeed.
    Electric.StatusMonitor.mark_connection_pool_ready(state.stack_id, pool_pid)
    state = mark_connection_succeeded(state)

    state = %{state | pool_pid: pool_pid, current_step: :start_shapes_supervisor}
    {:noreply, state, {:continue, :start_shapes_supervisor}}
  end

  def handle_continue(
        :start_shapes_supervisor,
        %State{
          current_phase: :connection_setup,
          current_step: :start_shapes_supervisor,
          shape_log_collector_pid: nil
        } = state
      ) do
    # Checking the timeline continuity to see if we need to purge all shapes persisted so far
    # and reset any replication related persistent state
    timeline_changed? =
      Electric.Timeline.check(
        {state.pg_system_identifier, state.pg_timeline_id},
        state.timeline_opts
      ) == :timeline_changed

    shape_cache_opts =
      state.shape_cache_opts
      |> Keyword.put(:purge_all_shapes?, state.purge_all_shapes? || timeline_changed?)

    if timeline_changed? do
      Electric.Replication.PersistentReplicationState.reset(
        stack_id: state.stack_id,
        persistent_kv: state.persistent_kv
      )

      dispatch_stack_event(
        {:warning,
         %{
           type: :database_id_or_timeline_changed,
           message:
             "Database ID or timeline changed. Purging shape logs from disk. Clients will refetch shape data automatically."
         }},
        state
      )
    end

    shapes_sup_pid =
      case Electric.Connection.Supervisor.start_shapes_supervisor(
             stack_id: state.stack_id,
             shape_cache_opts: shape_cache_opts,
             pool_opts: state.pool_opts,
             replication_opts: state.replication_opts,
             tweaks: state.tweaks,
             pg_version: state.pg_version,
             persistent_kv: state.persistent_kv
           ) do
        {:ok, shapes_sup_pid} ->
          shapes_sup_pid

        {:error, reason} ->
          Logger.error("Failed to start shape supervisor: #{inspect(reason)}")
          exit(reason)
      end

    # Remember the shape log collector pid for later because we want to tie the replication
    # client's lifetime to it.
    log_collector_pid = lookup_log_collector_pid(shapes_sup_pid)
    Process.monitor(log_collector_pid)

    state = %{
      state
      | shape_log_collector_pid: log_collector_pid,
        current_step: :waiting_for_consumers,
        purge_all_shapes?: false
    }

    {:noreply, state}
  end

  def handle_continue(
        :start_streaming,
        %State{
          current_phase: phase,
          current_step: {:start_replication_client, :start_streaming}
        } = state
      )
      when phase in [:connection_setup, :restarting_replication_client] do
    # Everything is ready to start accepting and processing logical messages from Postgres.
    Logger.info("Starting replication from postgres")
    Electric.Postgres.ReplicationClient.start_streaming(state.replication_client_pid)
    dispatch_stack_event(:ready, state)

    state = %{
      state
      | current_phase: :running,
        current_step: :waiting_for_streaming_confirmation
    }

    {:noreply, state}
  end

  @impl true
  def handle_info(
        {:timeout, tref, {:check_status, :lock_connection}},
        %State{
          lock_connection_timer: tref,
          current_phase: :connection_setup,
          current_step: {:start_lock_connection, :acquiring_lock}
        } = state
      ) do
    Logger.warning(fn -> "Waiting for postgres lock to be acquired..." end)
    tref = schedule_periodic_connection_status_check(:lock_connection)
    state = %{state | lock_connection_timer: tref}
    {:noreply, state}
  end

  def handle_info(
        {:timeout, tref, {:check_status, :replication_client}},
        %State{
          replication_client_timer: tref,
          current_phase: phase,
          current_step: {:start_replication_client, :configuring_connection}
        } = state
      )
      when phase in [:connection_setup, :restarting_replication_client] do
    Logger.warning(fn ->
      "Waiting for the replication connection setup to complete... " <>
        "Check that you don't have pending transactions in the database. " <>
        "Electric has to wait for all pending transactions to commit or rollback " <>
        "before it can create the replication slot."
    end)

    if not state.replication_client_blocked_by_pending_transaction? do
      dispatch_stack_event(:replication_slot_creation_blocked_by_pending_trasactions, state)
    end

    tref = schedule_periodic_connection_status_check(:replication_client)

    state = %{
      state
      | replication_client_timer: tref,
        replication_client_blocked_by_pending_transaction?: true
    }

    {:noreply, state}
  end

  def handle_info({:timeout, tref, {:check_status, _}}, state) do
    # The connection status must have changed after the last schedule_periodic_connection_status_check()
    # call and before this callback has been invoked. Or a new timer has been created, so this
    # one needs to lapse without scheduling another tick.
    state = nillify_timer(state, tref)
    {:noreply, state}
  end

  def handle_info(
        {:timeout, tref, {:retry_connection, step}},
        %State{connection_backoff: {conn_backoff, tref}} = state
      ) do
    state = %{state | connection_backoff: {conn_backoff, nil}}
    handle_continue(step, state)
  end

  # After a replication liveness timeout passes, if the same replication client is still
  # alive, a call to `mark_connection_succeeded()` resets the backoff timer, so the next
  # reconnection attempt will start from the minimum timeout and grow exponentially from
  # there.
  def handle_info(
        {:timeout, _tref, {:replication_liveness_check, replication_client_pid}},
        %State{replication_client_pid: replication_client_pid} = state
      ),
      do: {:noreply, mark_connection_succeeded(state)}

  def handle_info(
        {:timeout, _tref, {:replication_liveness_check, _replication_client_pid}},
        state
      ),
      do: {:noreply, state}

  # Special-case the explicit shutdown of the supervision tree.
  #
  # Supervisors send `:shutdown` exit signals to its children when they themselves are shutting
  # down. We don't need to react to this signal coming from any of our linked processes, just
  # ignore it.
  def handle_info({:EXIT, _, :shutdown}, state), do: {:noreply, state}

  # A process exited as it was trying to open a database connection.
  def handle_info({:EXIT, pid, reason}, %State{current_phase: :connection_setup} = state) do
    # Try repairing the connection opts and try connecting again. If we're already using noSSL
    # and IPv4, the error will be propagated to a `shutdown_or_reconnect()` function call
    # further down below.
    state = nillify_pid(state, pid)

    {step, _} = state.current_step
    conn_opts = connection_opts_for_step(step, state)

    repaired_conn_opts =
      case reason do
        %Postgrex.Error{message: "ssl not available"} ->
          maybe_fallback_to_no_ssl(conn_opts)

        # Seen this when connecting to Fly Postgres
        %DBConnection.ConnectionError{message: "ssl connect: closed"} ->
          maybe_fallback_to_no_ssl(conn_opts)

        %DBConnection.ConnectionError{message: message, severity: :error} ->
          maybe_fallback_to_ipv4(message, conn_opts)

        _ ->
          nil
      end

    if repaired_conn_opts do
      state = update_connection_opts(step, repaired_conn_opts, state)
      {:noreply, state, {:continue, step}}
    else
      shutdown_or_reconnect(reason, state)
    end
  end

  # The replication client exited after the connection setup has completed, it can be restarted
  # independently of the lock connection and the DB pool. On the other hand, if any of the
  # latter two shut down, Connection.Manager will itself terminate to be restarted by its
  # supervisor in a clean state.
  def handle_info(
        {:EXIT, pid, reason},
        %State{replication_client_pid: pid, current_phase: :running} = state
      ) do
    state = nillify_pid(state, pid)

    state = %{
      state
      | current_phase: :restarting_replication_client,
        current_step: {:start_replication_client, nil}
    }

    shutdown_or_reconnect(reason, state)
  end

  # The most likely reason for any database connection to get closed after we've already opened a
  # bunch of them is the database server going offline or shutting down. Stop
  # Connection.Manager to allow its supervisor to restart it in the initial state.
  def handle_info({:EXIT, pid, reason}, state) do
    error =
      reason
      |> strip_exit_signal_stacktrace()
      |> DbConnectionError.from_error()

    Logger.warning(
      "#{inspect(__MODULE__)} is restarting after it has encountered an error in process #{inspect(pid)}:\n" <>
        error.message <> "\n\n" <> inspect(state, pretty: true)
    )

    dispatch_stack_event(
      {:connection_error,
       %{
         error: DbConnectionError.format_original_error(error),
         type: error.type,
         message: error.message,
         total_retry_time: ConnectionBackoff.total_retry_time(elem(state.connection_backoff, 0))
       }},
      state
    )

    {:stop, {:shutdown, reason}, state}
  end

  def handle_info(
        {:DOWN, _ref, :process, pid, reason},
        %State{shape_log_collector_pid: pid} = state
      ) do
    # The replication client would normally exit together with the shape log collector when it
    # is blocked on a call to either `ShapeLogCollector.handle_relation_msg/2` or
    # `ShapeLogCollector.store_transaction/2` and the log collector encounters a storage error.
    #
    # Just to make sure that we restart the replication client when the shape log collector
    # crashes for any other reason, we explicitly stop the client here. It will be
    # automatically restarted by Connection.Manager upon the reception of the `{:EXIT, ...}` message.
    #
    # Note, though, that if the replication client process has already exited because the shape
    # log collector had exited, the below call to `stop()` will also exit (with same exit reason or
    # due to a timeout in `:gen_statem.call()`). Hence the wrapping of the function call in a
    # try-catch block.
    try do
      _ = Electric.Postgres.ReplicationClient.stop(state.replication_client_pid, reason)
    catch
      :exit, _reason ->
        # The replication client has already exited, so nothing else to do here.
        state
    end

    if state.drop_slot_requested do
      drop_slot(state)
    end

    {:noreply, %{state | shape_log_collector_pid: nil, replication_client_pid: nil}}
  end

  # The following two messages are sent by the DBConnection library because we've configured
  # the connection manager process as connection listener for the DB connection pool.
  def handle_info({:connected, conn_pid, ref}, %State{pool_ref: ref} = state) do
    Process.monitor(conn_pid, tag: :pool_conn_down)
    {:noreply, state}
  end

  def handle_info({:disconnected, _pid, ref}, %State{pool_ref: ref} = state) do
    {:noreply, state}
  end

  # When a pooled connection terminates, we log its exit reason, but more connections will
  # be started by the connection pool supervisor, so we don't need to do anything else.
  def handle_info({:pool_conn_down, _ref, :process, _pid, reason}, state)
      when reason in [:shutdown, :noproc] do
    {:noreply, state}
  end

  def handle_info({:pool_conn_down, _ref, :process, _pid, {:shutdown, exit_reason}}, state) do
    error = DbConnectionError.from_error(exit_reason)

    # If the error is of an unknown type, it would have already been logged by DbConnectionError itself.
    if error.type != :unknown do
      Logger.warning(
        "Pooled database connection encountered an error: " <>
          DbConnectionError.format_original_error(error)
      )
    end

    {:noreply, state}
  end

  @impl true
  def handle_cast(:drop_replication_slot_on_stop, state) do
    {:noreply, %{state | drop_slot_requested: true}}
  end

  def handle_cast(
        :lock_connection_started,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_lock_connection, :connecting}
        } = state
      ) do
    dispatch_stack_event(:waiting_for_connection_lock, state)
    state = mark_connection_succeeded(state)
    tref = schedule_periodic_connection_status_check(:lock_connection)

    state = %{
      state
      | lock_connection_timer: tref,
        current_step: {:start_lock_connection, :acquiring_lock}
    }

    {:noreply, state}
  end

  def handle_cast(
        {:exclusive_connection_lock_acquisition_failed, error},
        %State{
          current_phase: :connection_setup,
          current_step: {:start_lock_connection, :acquiring_lock}
        } = state
      ) do
    Electric.StatusMonitor.mark_pg_lock_as_errored(state.stack_id, inspect(error))

    dispatch_stack_event(
      {:failed_to_acquire_connection_lock, %{error: inspect(error, pretty: true)}},
      state
    )

    # The LockConnection process will keep retrying to acquire the lock.
    {:noreply, state}
  end

  def handle_cast(
        :exclusive_connection_lock_acquired,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_lock_connection, :acquiring_lock}
        } = state
      ) do
    Electric.StatusMonitor.mark_pg_lock_acquired(state.stack_id, state.lock_connection_pid)
    dispatch_stack_event(:connection_lock_acquired, state)

    # As soon as we acquire the connection lock, we try to start the replication connection
    # first because it requires additional privileges compared to regular "pooled" connections,
    # so failure to open a replication connection should be reported ASAP.
    state = %{state | current_step: {:start_replication_client, nil}}
    {:noreply, state, {:continue, :start_replication_client}}
  end

  def handle_cast(
        :replication_client_started,
        %State{
          current_phase: phase,
          current_step: {:start_replication_client, :connecting}
        } = state
      )
      when phase in [:connection_setup, :restarting_replication_client] do
    tref = schedule_periodic_connection_status_check(:replication_client)

    state = %{
      state
      | replication_client_timer: tref,
        current_step: {:start_replication_client, :configuring_connection}
    }

    {:noreply, state}
  end

  def handle_cast(
        :replication_client_created_new_slot,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_replication_client, :configuring_connection}
        } = state
      ) do
    # When the replication slot is created for the first time or recreated at any point, we
    # must invalidate all shapes to ensure transactional continuity and prevent missed changes.
    {:noreply, %{state | purge_all_shapes?: true}}
  end

  def handle_cast(
        :replication_client_created_new_slot,
        %State{
          current_phase: :restarting_replication_client,
          current_step: {:start_replication_client, :configuring_connection}
        } = state
      ) do
    # In the :restarting_replication_client phase the shape streaming pipeline is already
    # running, so we need to notify it about the need to purge existing shapes.
    :ok = Electric.ShapeCache.clean_all_shapes(stack_id: state.stack_id)
    {:noreply, state}
  end

  def handle_cast(
        :replication_client_ready_to_stream,
        %State{
          current_phase: phase,
          current_step: {:start_replication_client, :configuring_connection}
        } = state
      )
      when phase in [:connection_setup, :restarting_replication_client] do
    Electric.StatusMonitor.mark_replication_client_ready(
      state.stack_id,
      state.replication_client_pid
    )

    state = %{state | replication_client_blocked_by_pending_transaction?: false}

    case phase do
      :connection_setup ->
        # This is the case where Connection.Manager starts connections from the initial state.
        # Replication connection is opened after the lock connection has acquired the
        # exclusive lock. Now it's time to start the connection pool.
        state = %{state | current_step: :start_connection_pool}
        {:noreply, state, {:continue, :start_connection_pool}}

      :restarting_replication_client ->
        # The replication client process exited while the other connection processes were
        # already running. Now that it's been restarted, we can transition it into the
        # logical replication mode immediately since all the other connection process and the
        # shapes supervisor are already up.
        state = %{state | current_step: {:start_replication_client, :start_streaming}}
        {:noreply, state, {:continue, :start_streaming}}
    end
  end

  def handle_cast(
        :consumers_ready,
        %State{
          current_phase: :connection_setup,
          current_step: :waiting_for_consumers
        } = state
      ) do
    state = %State{state | current_step: {:start_replication_client, :start_streaming}}
    {:noreply, state, {:continue, :start_streaming}}
  end

  def handle_cast(
        :replication_client_streamed_first_message,
        %State{current_phase: :running, current_step: :waiting_for_streaming_confirmation} = state
      ) do
    # When the replication connection is stuck in a reconnection loop, we only mark it as
    # having succeeded after receiving confirmation that streaming replication has started
    # and waiting for some time to ensure no errors are sent over the stream due to a failure
    # to start replication.
    # This is the only way to be sure because it can still fail after we issue the
    # start_streaming() call, so marking it as having succeeded earlier would result in a
    # reconnection loop with no exponential backoff.
    :erlang.start_timer(
      @replication_liveness_confirmation_duration,
      self(),
      {:replication_liveness_check, state.replication_client_pid}
    )

    state = %{state | current_step: :streaming}
    {:noreply, state}
  end

  def handle_cast({:pg_system_info_obtained, info}, state) do
    {:noreply,
     %{
       state
       | pg_system_identifier: info.system_identifier,
         pg_timeline_id: info.timeline_id
     }}
  end

  def handle_cast({:pg_info_obtained, %{server_version_num: server_version}}, state) do
    Logger.info(
      "Postgres server version = #{server_version}, " <>
        "system identifier = #{state.pg_system_identifier}, " <>
        "timeline_id = #{state.pg_timeline_id}"
    )

    :telemetry.execute(
      [:electric, :postgres, :info_looked_up],
      %{
        pg_version: server_version,
        pg_system_identifier: state.pg_system_identifier,
        pg_timeline_id: state.pg_timeline_id
      },
      %{stack_id: state.stack_id}
    )

    {:noreply, %{state | pg_version: server_version}}
  end

  @impl true
  def handle_call(:ping, _from, state) do
    {:reply, :pong, state}
  end

  @impl true
  def terminate(reason, state) do
    # Ensure that all children of the connection manager are stopped
    # before the manager itself terminates.
    # This is important to ensure that upon restarting on an error the
    # connection manager is able to start the processes in a clean state.
    Logger.debug("Terminating connection manager with reason #{inspect(reason)}.")

    %{
      pool_pid: pool_pid,
      replication_client_pid: replication_client_pid,
      lock_connection_pid: lock_connection_pid
    } = state

    Electric.Connection.Supervisor.stop_shapes_supervisor(state.stack_id)
    if is_pid(pool_pid), do: shutdown_child(pool_pid, :shutdown)
    if is_pid(replication_client_pid), do: shutdown_child(replication_client_pid, :shutdown)

    # We brutally kill the lock connection process as it might hang on waiting
    # to establish a connection and can't be gracefully killed
    if is_pid(lock_connection_pid), do: shutdown_child(lock_connection_pid, :kill)

    {:stop, reason, state}
  end

  defp shutdown_child(pid, :shutdown) when is_pid(pid) do
    ref = Process.monitor(pid)
    Process.exit(pid, :shutdown)

    receive do
      {:DOWN, ^ref, :process, ^pid, _reason} -> :ok
    after
      5000 -> shutdown_child(pid, :kill)
    end
  end

  defp shutdown_child(pid, :kill) when is_pid(pid) do
    ref = Process.monitor(pid)
    Process.exit(pid, :kill)

    receive do
      {:DOWN, ^ref, :process, ^pid, _reason} -> :ok
    end
  end

  defp maybe_fallback_to_ipv4(error_message, conn_opts) do
    # If network is unreachable, IPv6 is not enabled on the machine
    # If domain cannot be resolved, assume there is no AAAA record for it
    # Fall back to IPv4 for these cases
    if conn_opts[:ipv6] and
         String.starts_with?(error_message, "tcp connect (") and
         (String.ends_with?(error_message, "): non-existing domain - :nxdomain") or
            String.ends_with?(error_message, "): host is unreachable - :ehostunreach") or
            String.ends_with?(error_message, "): network is unreachable - :enetunreach")) do
      Logger.warning(
        "Database connection failed to find valid IPv6 address for #{conn_opts[:hostname]} - falling back to IPv4"
      )

      conn_opts |> Keyword.put(:ipv6, false) |> populate_tcp_opts()
    end
  end

  defp maybe_fallback_to_no_ssl(conn_opts) do
    sslmode = conn_opts[:sslmode]

    if sslmode != :require do
      if not is_nil(sslmode) do
        # Only log a warning when there's an explicit sslmode parameter in the database
        # config, meaning the user has requested a certain sslmode.
        Logger.warning(
          "Failed to connect to the database using SSL. Trying again, using an unencrypted connection."
        )
      end

      Keyword.put(conn_opts, :ssl, false)
    end
  end

  defp shutdown_or_reconnect(error, state) do
    error =
      error
      |> strip_exit_signal_stacktrace()
      |> DbConnectionError.from_error()

    with false <- drop_slot_and_restart(error, state),
         false <- stop_if_fatal_error(error, state) do
      state = schedule_reconnection_after_error(error, state)
      {:noreply, state}
    end
  end

  defp schedule_reconnection_after_error(error, state) do
    message = error.message
    connection_mode = set_connection_status_error(message, state)

    extended_message = message <> pg_error_extra_info(error.original_error)

    Logger.warning(
      "Database connection in #{connection_mode} mode failed: #{extended_message}\nRetrying..."
    )

    dispatch_stack_event(
      {:connection_error,
       %{
         error: DbConnectionError.format_original_error(error),
         type: error.type,
         message: message,
         total_retry_time: ConnectionBackoff.total_retry_time(elem(state.connection_backoff, 0))
       }},
      state
    )

    {step, _} = state.current_step
    schedule_reconnection(step, state)
  end

  defp set_connection_status_error(
         error_message,
         %State{
           current_phase: :connection_setup,
           current_step: {:start_lock_connection, _}
         } = state
       ) do
    StatusMonitor.mark_pg_lock_as_errored(state.stack_id, error_message)
    "lock_connection"
  end

  defp set_connection_status_error(
         error_message,
         %State{
           current_phase: phase,
           current_step: {:start_replication_client, _}
         } = state
       )
       when phase in [:connection_setup, :restarting_replication_client] do
    StatusMonitor.mark_replication_client_as_errored(state.stack_id, error_message)
    "replication"
  end

  defp set_connection_status_error(
         error_message,
         %State{current_phase: :connection_setup} = state
       ) do
    StatusMonitor.mark_connection_pool_as_errored(state.stack_id, error_message)
    "connection_pool"
  end

  defp set_connection_status_error(_error_message, _state) do
    "regular"
  end

  defp pg_error_extra_info(%Postgrex.Error{postgres: pg_error}) do
    extra_info_items =
      [
        {"PG code:", Map.get(pg_error, :pg_code)},
        {"PG routine:", Map.get(pg_error, :routine)}
      ]
      |> Enum.reject(fn {_, val} -> is_nil(val) end)
      |> Enum.map(fn {label, val} -> "#{label} #{val}" end)

    if extra_info_items != [] do
      " (" <> Enum.join(extra_info_items, ", ") <> ")"
    else
      ""
    end
  end

  defp pg_error_extra_info(_), do: ""

  defp drop_slot_and_restart(%DbConnectionError{drop_replication_slot?: true} = error, state) do
    Logger.warning(error.message)

    dispatch_stack_event(
      {:warning,
       %{
         type: error.type,
         message: error.message,
         error: DbConnectionError.format_original_error(error)
       }},
      state
    )

    drop_slot(state)

    Electric.Timeline.store_irrecoverable_timeline(
      state.pg_system_identifier,
      state.timeline_opts
    )

    {:stop, {:shutdown, error.type}, state}
  end

  defp drop_slot_and_restart(_, _), do: false

  defp stop_if_fatal_error(error, state) do
    if error.retry_may_fix? do
      false
    else
      dispatch_fatal_error_and_shutdown(error, state)
    end
  end

  defp dispatch_fatal_error_and_shutdown(%DbConnectionError{} = error, state) do
    dispatch_stack_event(
      {:config_error,
       %{
         error: DbConnectionError.format_original_error(error),
         message: error.message,
         type: error.type
       }},
      state
    )

    # Perform supervisor shutdown in a task to avoid a circular dependency where the manager
    # process is waiting for the supervisor to shut down its children, one of which is the
    # manager process itself.
    Task.start(Electric.Connection.Supervisor, :shutdown, [state.stack_id, error])

    {:noreply, state}
  end

  defp schedule_reconnection(
         step,
         %State{
           connection_backoff: {conn_backoff, _}
         } = state
       ) do
    {time, conn_backoff} = ConnectionBackoff.fail(conn_backoff)
    tref = :erlang.start_timer(time, self(), {:retry_connection, step})
    Logger.warning("Reconnecting in #{inspect(time)}ms")
    %{state | connection_backoff: {conn_backoff, tref}}
  end

  defp mark_connection_succeeded(%State{connection_backoff: {conn_backoff, tref}} = state) do
    {total_retry_time, conn_backoff} = ConnectionBackoff.succeed(conn_backoff)

    if total_retry_time > 0 do
      Logger.info("Reconnection succeeded after #{inspect(total_retry_time)}ms")
    end

    %{state | connection_backoff: {conn_backoff, tref}}
  end

  defp populate_ssl_opts(connection_opts) do
    ssl_opts =
      case connection_opts[:sslmode] do
        :disable ->
          false

        _ ->
          hostname = String.to_charlist(connection_opts[:hostname])

          ssl_verify_opts()
          |> Keyword.put(:server_name_indication, hostname)
      end

    Keyword.put(connection_opts, :ssl, ssl_opts)
  end

  # We explicitly set `verify` to `verify_none` because it's currently the only way to ensure
  # encrypted connections work even when a faulty certificate chain is presented by the PG host.
  # This behaviour matches that of `psql <DATABASE_URL>?sslmode=require`.
  #
  # Here's an example of connecting to DigitalOcean's Managed PostgreSQL to illustrate the point.
  # Specifying `sslmode=require` does not result in any certificate validation, it only instructs
  # `psql` to use SSL for the connection:
  #
  #     $ psql 'postgresql://...?sslmode=require'
  #     psql (16.1, server 16.3)
  #     SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)
  #     Type "help" for help.
  #
  #     [db-postgresql-do-user-13160360-0] doadmin:defaultdb=> \q
  #
  # Now if we request certificate validation, we get a different result:
  #
  #     $ psql 'postgresql://...?sslmode=verify-full'
  #     psql: error: connection to server at "***.db.ondigitalocean.com" (167.99.250.38), o
  #     port 25060 failed: root certificate file "/home/alco/.postgresql/root.crt" does not exist
  #     Either provide the file, use the system's trusted roots with sslrootcert=system, or change
  #     sslmode to disable server certificate verification.
  #
  #     $ psql 'sslrootcert=system sslmode=verify-full host=***.db.ondigitalocean.com ...'
  #     psql: error: connection to server at "***.db.ondigitalocean.com" (167.99.250.38), port 25060
  #     failed: SSL error: certificate verify failed
  #
  # We can a better idea of what's wrong with the certificate with `openssl`'s help:
  #
  #     $ openssl s_client -starttls postgres -showcerts -connect ***.db.ondigitalocean.com:25060 -CApath /etc/ssl/certs/
  #     [...]
  #     SSL handshake has read 3990 bytes and written 885 bytes
  #     Verification error: self-signed certificate in certificate chain
  #
  # So, until we find a way to deal with such PG hosts, we'll use `verify_none` to explicitly
  # silence any warnings originating in Postgrex, since we're already forbidding the use of
  # `sslmode=verify-ca` and `sslmode=verify-full` in the database URL parsing code.
  defp ssl_verify_opts do
    [verify: :verify_none]
  end

  defp populate_tcp_opts(connection_opts) do
    tcp_opts =
      if connection_opts[:ipv6] do
        [:inet6]
      else
        []
      end

    Keyword.put(connection_opts, :socket_options, tcp_opts)
  end

  defp populate_connection_opts(conn_opts),
    do: conn_opts |> populate_ssl_opts() |> populate_tcp_opts()

  defp connection_opts_for_step(step, state)
       when step in [:start_lock_connection, :start_replication_client] do
    replication_connection_opts(state)
  end

  defp connection_opts_for_step(_step, state) do
    pooled_connection_opts(state)
  end

  defp replication_connection_opts(state) do
    state
    |> replication_opts()
    |> Keyword.fetch!(:connection_opts)
  end

  defp pooled_connection_opts(state) do
    state.shared_connection_opts || state.connection_opts
  end

  defp replication_opts(%State{shared_connection_opts: nil} = state), do: state.replication_opts

  defp replication_opts(%State{shared_connection_opts: conn_opts} = state),
    do: Keyword.put(state.replication_opts, :connection_opts, conn_opts)

  defp update_connection_opts(
         step,
         conn_opts,
         %State{shared_connection_opts: nil, replication_opts: replication_opts} = state
       )
       when step in [:start_lock_connection, :start_replication_client] do
    %{state | replication_opts: put_in(replication_opts, [:connection_opts], conn_opts)}
  end

  defp update_connection_opts(_step, conn_opts, %State{shared_connection_opts: nil} = state) do
    %{state | connection_opts: conn_opts}
  end

  defp update_connection_opts(_step, conn_opts, state) do
    %{state | shared_connection_opts: conn_opts}
  end

  defp lookup_log_collector_pid(shapes_supervisor) do
    {Electric.Replication.ShapeLogCollector, log_collector_pid, :worker, _modules} =
      shapes_supervisor
      |> Supervisor.which_children()
      |> List.keyfind(Electric.Replication.ShapeLogCollector, 0)

    log_collector_pid
  end

  defp drop_slot(%State{pool_pid: nil} = _state) do
    Logger.warning("Skipping slot drop, pool connection not available")
  end

  defp drop_slot(%State{pool_pid: pool} = state) do
    publication_name = Keyword.fetch!(state.replication_opts, :publication_name)
    slot_name = Keyword.fetch!(state.replication_opts, :slot_name)
    slot_temporary? = Keyword.fetch!(state.replication_opts, :slot_temporary?)

    if !slot_temporary? do
      execute_and_log_errors(pool, "SELECT pg_drop_replication_slot('#{slot_name}');")
    end

    execute_and_log_errors(pool, "DROP PUBLICATION #{publication_name}")
  end

  defp execute_and_log_errors(pool, query) do
    case Postgrex.query(pool, query, []) do
      {:ok, _} ->
        :ok

      {:error, error} ->
        Logger.error("Failed to execute query: #{query}\nError: #{inspect(error)}")
    end
  end

  defp schedule_periodic_connection_status_check(type) do
    :erlang.start_timer(@connection_status_check_interval, self(), {:check_status, type})
  end

  # It's possible that the exit signal received from an exiting process includes a
  # stacktrace. This happens when the process crashes due an exception getting raised as
  # opposed to exiting with a custom reason in an orderly fashion.
  defp strip_exit_signal_stacktrace(error) do
    case error do
      {reason, stacktrace} when is_list(stacktrace) ->
        if stacktrace?(stacktrace) do
          reason
        else
          error
        end

      _ ->
        error
    end
  end

  defp stacktrace?(val) do
    try do
      _ = Exception.format_stacktrace(val)
      true
    rescue
      _ -> false
    end
  end

  defp dispatch_stack_event(event, state) do
    Electric.StackSupervisor.dispatch_stack_event(
      state.stack_events_registry,
      state.stack_id,
      event
    )
  end

  defp nillify_pid(%State{lock_connection_pid: pid} = state, pid),
    do: %{state | lock_connection_pid: nil}

  defp nillify_pid(%State{replication_client_pid: pid} = state, pid),
    do: %{state | replication_client_pid: nil}

  defp nillify_pid(%State{pool_pid: pid} = state, pid),
    do: %{state | pool_pid: nil}

  defp nillify_pid(%State{shape_log_collector_pid: pid} = state, pid),
    do: %{state | shape_log_collector_pid: nil}

  defp nillify_timer(%State{lock_connection_timer: tref} = state, tref),
    do: %{state | lock_connection_timer: nil}

  defp nillify_timer(%State{replication_client_timer: tref} = state, tref),
    do: %{state | replication_client_timer: nil}

  defp nillify_timer(state, _tref), do: state
end
