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
        ...,metadata
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
  # level, it can be in one of two phases:
  #
  #   - :connection_setup
  #   - :running
  #
  # Connection manager starts in the :connection_setup phase and moves into the :running phase
  # after all processes have been started and the replication client is given the command to
  # start streaming.
  #
  # If any connection process exits, connection manager itself will shut down to start
  # from scratch, as there could be too many failure states to address each one individually.
  #
  # The 2nd level of the state machine splits the current phase into a series of steps which
  # the process goes through until it finishes the connection setup phase and transitions into
  # the running phase.
  #
  # Function clauses match on the current phase and step as a way to both assert on the current
  # state as well as make the code more self-documenting.

  defmodule State do
    @type phase :: :connection_setup | :running
    @type step ::
            {:start_lock_connection, nil}
            | {:start_lock_connection, :connecting}
            | {:start_lock_connection, :acquiring_lock}
            | {:start_replication_client, nil}
            | {:start_replication_client, :connecting}
            | {:start_replication_client, :configuring_connection}
            | {:start_connection_pool, nil}
            | {:start_connection_pool, :connecting}
            | :start_replication_supervisor
            | {:waiting_for_consumers, integer()}
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
      # Database connection pool options
      :pool_opts,
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
      # Postgres backend PID serving the lock connection
      :lock_connection_pg_backend_pid,
      # Timer reference for the periodic lock status check
      :lock_connection_timer,
      # PIDs of the database connection pools
      :pool_pids,
      # Backoff term used for reconnection with exponential back-off
      :connection_backoff,
      # PostgreSQL server version
      :pg_version,
      # PostgreSQL system identifier
      :pg_system_identifier,
      # PostgreSQL timeline ID
      :pg_timeline_id,
      # Capability flag that is set during replication client initialization and shows whether
      # the PG role has the necessary privilege to alter the PG publication.
      :can_alter_publication?,
      # User setting that determines whether the table publishing is to be automatically
      # managed by the stack or whether it's the user's responsibility.
      :manual_table_publishing?,
      # ID used for process labeling and sibling discovery
      :stack_id,
      # Registry used for stack events
      :stack_events_registry,
      :tweaks,
      :max_shapes,
      :expiry_batch_size,
      :persistent_kv,
      :purge_all_shapes?,
      validated_connection_opts: %{replication: nil, pool: nil},
      drop_slot_requested: false
    ]
  end

  use GenServer, shutdown: :infinity
  alias Electric.Postgres.LockBreakerConnection
  alias Electric.Connection.Manager.ConnectionBackoff
  alias Electric.Connection.Manager.ConnectionResolver
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

  def snapshot_pool(stack_id) do
    pool_name(stack_id, :snapshot)
  end

  def admin_pool(stack_id) do
    pool_name(stack_id, :admin)
  end

  def pool_name(stack_id, role) when is_binary(stack_id) and role in [:admin, :snapshot] do
    Electric.ProcessRegistry.name(stack_id, @db_pool_ephemeral_module_name, role)
  end

  def pool_name(opts) do
    pool_name(Access.fetch!(opts, :stack_id), Access.fetch!(opts, :role))
  end

  def drop_replication_slot_on_stop(manager) do
    GenServer.cast(manager, :drop_replication_slot_on_stop)
  end

  def lock_connection_started(manager) do
    GenServer.cast(manager, :lock_connection_started)
  end

  def consumers_ready(stack_id, total_recovered, total_failed_to_recover) do
    GenServer.cast(name(stack_id), {:consumers_ready, total_recovered, total_failed_to_recover})
  end

  def exclusive_connection_lock_acquisition_failed(manager, error) do
    GenServer.cast(manager, {:exclusive_connection_lock_acquisition_failed, error})
  end

  def exclusive_connection_lock_acquired(manager) do
    GenServer.cast(manager, :exclusive_connection_lock_acquired)
  end

  def lock_connection_pid_obtained(manager, pid) do
    GenServer.cast(manager, {:lock_connection_pid_obtained, pid})
  end

  def replication_client_started(manager) do
    GenServer.cast(manager, :replication_client_started)
  end

  def replication_client_created_new_slot(manager) do
    GenServer.cast(manager, :replication_client_created_new_slot)
  end

  def replication_client_has_insufficient_privilege(manager) do
    GenServer.cast(manager, :replication_client_has_insufficient_privilege)
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

  def connection_pool_ready(manager, role, pid) do
    GenServer.cast(manager, {:connection_pool_ready, role, pid})
  end

  def connection_resolver_ready(stack_id) do
    stack_id
    |> name()
    |> GenServer.cast(:connection_resolver_ready)
  end

  def pool_sizes(total_pool_size) do
    if total_pool_size < 2 do
      Logger.warning(
        "The configured connection pool size #{total_pool_size} is below the minimum of 2"
      )
    end

    # use 1/4 of the available connections with a min of 1 and max of 4
    max_admin_connections = 4
    min_admin_connections = 1

    metadata_pool_size =
      min(max(div(total_pool_size, 4), min_admin_connections), max_admin_connections)

    snapshot_pool_size =
      if(total_pool_size >= metadata_pool_size,
        do: max(total_pool_size - metadata_pool_size, metadata_pool_size),
        else: metadata_pool_size
      )

    %{snapshot: snapshot_pool_size, admin: metadata_pool_size}
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

    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:connection_manager, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    pool_opts = Keyword.fetch!(opts, :pool_opts)
    timeline_opts = Keyword.fetch!(opts, :timeline_opts)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)

    connection_backoff =
      Keyword.get(opts, :connection_backoff, ConnectionBackoff.init(1000, 10_000))

    state =
      %State{
        current_phase: :connection_setup,
        current_step: {:start_lock_connection, nil},
        pool_opts: pool_opts,
        timeline_opts: timeline_opts,
        shape_cache_opts: shape_cache_opts,
        connection_backoff: {connection_backoff, nil},
        stack_id: stack_id,
        stack_events_registry: Keyword.fetch!(opts, :stack_events_registry),
        tweaks: Keyword.fetch!(opts, :tweaks),
        persistent_kv: Keyword.fetch!(opts, :persistent_kv),
        can_alter_publication?: true,
        manual_table_publishing?: Keyword.get(opts, :manual_table_publishing?, false),
        max_shapes: Keyword.fetch!(opts, :max_shapes),
        expiry_batch_size: Keyword.fetch!(opts, :expiry_batch_size)
      }
      |> init_connection_opts(opts)
      |> init_validated_connection_opts()

    # Wait for the connection resolver to start before continuing with
    # connection setup.
    {:ok, state}
  end

  defp init_connection_opts(state, opts) do
    connection_opts = Keyword.fetch!(opts, :connection_opts)

    replication_opts =
      opts
      |> Keyword.fetch!(:replication_opts)
      |> Keyword.put(:start_streaming?, false)
      |> Keyword.put(:connection_manager, self())

    %{state | connection_opts: connection_opts, replication_opts: replication_opts}
  end

  defp init_validated_connection_opts(%{stack_id: stack_id} = state) do
    Map.update!(state, :validated_connection_opts, fn map ->
      Map.new(map, fn {type, nil} ->
        {type, Electric.StackConfig.get(stack_id, validated_conn_opts_config_key(type))}
      end)
    end)
  end

  defp validate_connection(conn_opts, type, state) do
    config_key = validated_conn_opts_config_key(type)

    opts =
      Map.get(state.validated_connection_opts, type) ||
        Electric.StackConfig.get(state.stack_id, config_key)

    if opts do
      {:ok, opts, state}
    else
      try do
        with {:ok, validated_opts} <- ConnectionResolver.validate(state.stack_id, conn_opts) do
          Electric.StackConfig.put(state.stack_id, config_key, validated_opts)

          {:ok, validated_opts,
           Map.update!(state, :validated_connection_opts, &Map.put(&1, type, validated_opts))}
        end
      catch
        :exit, {:killed, _} -> {:error, :killed}
      end
    end
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
    case validate_connection(replication_connection_opts(state), :replication, state) do
      {:ok, replication_connection_opts, state} ->
        opts = [
          # Lock connection must be direct-to-database, hence no pooled connection opts here.
          connection_opts: replication_connection_opts,
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

      # the ConnectionResolver process was killed, as part of the application
      # shutdown in which case we'll be killed next so just return here
      {:error, :killed} ->
        {:noreply, state}

      {:error, reason} ->
        shutdown_or_reconnect(reason, :lock_connection, state)
    end
  end

  def handle_continue(
        :start_replication_client,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_replication_client, _},
          replication_client_pid: nil
        } = state
      ) do
    case validate_connection(replication_connection_opts(state), :replication, state) do
      {:ok, replication_connection_opts, state} ->
        opts = [
          replication_opts:
            Keyword.put(state.replication_opts, :connection_opts, replication_connection_opts),
          connection_manager: self(),
          stack_id: state.stack_id
        ]

        Logger.debug("Starting replication client for stack #{state.stack_id}")

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

      {:error, reason} ->
        shutdown_or_reconnect(reason, :replication_client, state)
    end
  end

  def handle_continue(
        :start_connection_pool,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_connection_pool, _},
          pool_pids: nil
        } = state
      ) do
    Logger.debug("Starting connection pool for stack #{state.stack_id}")

    case validate_connection(pooled_connection_opts(state), :pool, state) do
      {:ok, conn_opts, state} ->
        pool_sizes = pool_sizes(Keyword.get(state.pool_opts, :pool_size, 2))

        {:ok, snapshot_pool_pid} =
          Electric.Connection.Manager.Pool.start_link(
            stack_id: state.stack_id,
            role: :snapshot,
            connection_manager: self(),
            pool_opts: Keyword.put(state.pool_opts, :pool_size, pool_sizes.snapshot),
            conn_opts: conn_opts
          )

        {:ok, admin_pool_pid} =
          Electric.Connection.Manager.Pool.start_link(
            stack_id: state.stack_id,
            role: :admin,
            connection_manager: self(),
            pool_opts: Keyword.put(state.pool_opts, :pool_size, pool_sizes.admin),
            conn_opts: conn_opts
          )

        state = %{
          state
          | pool_pids: %{admin: {admin_pool_pid, false}, snapshot: {snapshot_pool_pid, false}},
            current_step: {:start_connection_pool, :connecting}
        }

        {:noreply, state}

      # the ConnectionResolver process was killed, as part of the application
      # shutdown in which case we'll be killed next so just return here
      {:error, :killed} ->
        {:noreply, state}

      {:error, reason} ->
        shutdown_or_reconnect(reason, :pools, state)
    end
  end

  def handle_continue(
        :start_replication_supervisor,
        %State{
          current_phase: :connection_setup,
          current_step: :start_replication_supervisor
        } = state
      ) do
    # Checking the timeline continuity to see if we need to purge all shapes persisted so far
    # and reset any replication related persistent state
    timeline_changed? =
      Electric.Timeline.check(
        {state.pg_system_identifier, state.pg_timeline_id},
        state.timeline_opts
      ) == :timeline_changed

    if timeline_changed? or state.purge_all_shapes? do
      # Before starting the replication supervisor, clean up the on-disk storage from all shapes.
      Electric.Replication.Supervisor.reset_storage(shape_cache_opts: state.shape_cache_opts)

      # The ShapeStatusOwner process lives independently of connection or replication
      # supervisor. Purge all shapes from it before starting the replication supervisor.
      Electric.ShapeCache.ShapeStatus.reset(state.stack_id)
    end

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
             "Database ID or timeline changed. Purging shape logs from disk. " <>
               "Clients will refetch shape data automatically."
         }},
        state
      )
    end

    repl_sup_opts = [
      stack_id: state.stack_id,
      shape_cache_opts: state.shape_cache_opts,
      pool_opts: state.pool_opts,
      replication_opts: state.replication_opts,
      tweaks: state.tweaks,
      can_alter_publication?: state.can_alter_publication?,
      manual_table_publishing?: state.manual_table_publishing?,
      persistent_kv: state.persistent_kv,
      max_shapes: state.max_shapes,
      expiry_batch_size: state.expiry_batch_size
    ]

    start_time = System.monotonic_time()

    with {:error, reason} <-
           Electric.Connection.Manager.Supervisor.start_replication_supervisor(repl_sup_opts) do
      Logger.error("Failed to start shape supervisor: #{inspect(reason)}")
      exit(reason)
    end

    state = %{
      state
      | current_step: {:waiting_for_consumers, start_time},
        purge_all_shapes?: false
    }

    {:noreply, state}
  end

  def handle_continue(
        :start_streaming,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_replication_client, :start_streaming}
        } = state
      ) do
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

  def handle_continue(
        :check_lock_not_abandoned,
        %State{lock_connection_pg_backend_pid: pid} = state
      ) do
    if state.current_step == {:start_lock_connection, :acquiring_lock} and not is_nil(pid) do
      with {:ok, conn_opts, state} <-
             validate_connection(pooled_connection_opts(state), :pool, state),
           {:ok, breaker_pid} <-
             LockBreakerConnection.start(connection_opts: conn_opts, stack_id: state.stack_id) do
        lock_name = Keyword.fetch!(state.replication_opts, :slot_name)

        LockBreakerConnection.stop_backends_and_close(breaker_pid, lock_name, pid)
      else
        {:error, reason} ->
          # no-op, this is a one-shot attempt at fixing a lock
          Logger.warning("Failed try and break stuck lock connection: #{inspect(reason)}")
          :ok
      end
    end

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
    {:noreply, state, {:continue, :check_lock_not_abandoned}}
  end

  def handle_info(
        {:timeout, tref, {:check_status, :replication_client}},
        %State{
          replication_client_timer: tref,
          current_phase: :connection_setup,
          current_step: {:start_replication_client, :configuring_connection}
        } = state
      ) do
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
  def handle_info({:EXIT, _pid, :shutdown}, state), do: {:noreply, state}

  # The replication client exited because it hasn't streamed any new transactions for a while.
  # This is a signal for all database connections to close and transition Electric into a
  # scaled down mode.
  def handle_info(
        {:EXIT, pid, {:shutdown, {:connection_idle, time}}},
        %State{replication_client_pid: pid, current_phase: :running} = state
      ) do
    time_s = System.convert_time_unit(time, :millisecond, :second)

    Logger.notice(
      "Closing all database connections after the replication stream has been idle for #{time_s} seconds"
    )

    Electric.Connection.Restarter.stop_connection_subsystem(state.stack_id)

    {:noreply, state}
  end

  # A process exited as it was trying to open a database connection or while it was connected.
  def handle_info({:EXIT, pid, reason}, state) do
    {pid_type, state} = nillify_pid(state, pid)
    shutdown_or_reconnect(reason, pid_type, state)
  end

  @impl true
  def handle_cast(:connection_resolver_ready, state) do
    # Try to acquire the connection lock on the replication slot
    # before starting shape and replication processes, to ensure
    # a single active sync service is connected to Postgres per slot.
    {:noreply, state, {:continue, :start_lock_connection}}
  end

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
          current_phase: :connection_setup,
          current_step: {:start_replication_client, :connecting}
        } = state
      ) do
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
        :replication_client_has_insufficient_privilege,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_replication_client, :configuring_connection}
        } = state
      ) do
    {:noreply, %{state | can_alter_publication?: false}}
  end

  def handle_cast(
        :replication_client_ready_to_stream,
        %State{
          current_phase: :connection_setup,
          current_step: {:start_replication_client, :configuring_connection}
        } = state
      ) do
    Electric.StatusMonitor.mark_replication_client_ready(
      state.stack_id,
      state.replication_client_pid
    )

    state = %{
      state
      | replication_client_blocked_by_pending_transaction?: false,
        current_step: {:start_connection_pool, nil}
    }

    {:noreply, state, {:continue, :start_connection_pool}}
  end

  def handle_cast(
        {:connection_pool_ready, role, pid},
        %State{
          current_phase: :connection_setup,
          current_step: {:start_connection_pool, :connecting}
        } = state
      ) do
    Electric.StatusMonitor.mark_connection_pool_ready(
      state.stack_id,
      role,
      pid
    )

    state = Map.update!(state, :pool_pids, &Map.put(&1, role, {pid, true}))

    case state.pool_pids do
      %{admin: {pid1, true}, snapshot: {pid2, true}} when is_pid(pid1) and is_pid(pid2) ->
        state = mark_connection_succeeded(state)

        {:noreply, %{state | current_step: :start_replication_supervisor},
         {:continue, :start_replication_supervisor}}

      _ ->
        {:noreply, state}
    end
  end

  def handle_cast(
        {:consumers_ready, total_recovered, total_failed_to_recover},
        %State{
          current_phase: :connection_setup,
          current_step: {:waiting_for_consumers, start_time}
        } = state
      ) do
    duration = System.monotonic_time() - start_time

    Logger.notice(
      "Consumers ready in #{System.convert_time_unit(duration, :native, :millisecond)}ms (#{total_recovered} shapes, #{total_failed_to_recover} failed to recover)"
    )

    Electric.Telemetry.OpenTelemetry.execute(
      [:electric, :connection, :consumers_ready],
      %{duration: duration, total: total_recovered, failed_to_recover: total_failed_to_recover},
      %{stack_id: state.stack_id}
    )

    state = %{state | current_step: {:start_replication_client, :start_streaming}}
    {:noreply, state, {:continue, :start_streaming}}
  end

  def handle_cast({:consumers_ready, _recovered, _failed} = msg, state) do
    Logger.debug("Received #{inspect(msg)} in phase #{state.current_phase}: ignoring")
    {:noreply, state}
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

    Logger.debug("Replication client started streaming")

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

  def handle_cast({:lock_connection_pid_obtained, pid}, state) do
    {:noreply, %{state | lock_connection_pg_backend_pid: pid}}
  end

  def handle_cast({:pg_info_obtained, %{server_version_num: server_version}}, state) do
    Logger.info(
      "Postgres server version = #{server_version}, " <>
        "system identifier = #{state.pg_system_identifier}, " <>
        "timeline_id = #{state.pg_timeline_id}"
    )

    Electric.Telemetry.OpenTelemetry.execute(
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
      replication_client_pid: replication_client_pid,
      lock_connection_pid: lock_connection_pid
    } = state

    if is_pid(replication_client_pid), do: shutdown_child(replication_client_pid, :shutdown)

    case state.pool_pids do
      %{admin: {metadata_pool_pid, _}, snapshot: {snapshot_pool_pid, _}} ->
        if state.drop_slot_requested do
          drop_slot(state)
        end

        if is_pid(metadata_pool_pid), do: shutdown_child(metadata_pool_pid, :shutdown)
        if is_pid(snapshot_pool_pid), do: shutdown_child(snapshot_pool_pid, :shutdown)

      _ ->
        :ok
    end

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

  defp shutdown_or_reconnect(error, pid_type, state) do
    error =
      error
      |> strip_shutdown_atom()
      |> strip_exit_signal_stacktrace()
      |> DbConnectionError.from_error()

    with false <- drop_slot_and_restart(error, state),
         false <- stop_if_fatal_error(error, state) do
      if state.current_phase == :connection_setup do
        state = schedule_reconnection_after_error(error, pid_type, state)
        {:noreply, state}
      else
        notify_restart_after_error(error, pid_type, state)
        {:stop, {:shutdown, error.type}, state}
      end
    end
  end

  defp notify_restart_after_error(error, pid_type, state) do
    message = error.message
    connection_mode = set_connection_status_error(message, pid_type, state)

    extended_message = message <> pg_error_extra_info(error.original_error)

    Logger.warning(
      "#{inspect(__MODULE__)} is restarting after it has encountered an error in #{connection_mode} mode: #{extended_message}\n" <>
        message <> "\n\n" <> inspect(state, pretty: true)
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
  end

  defp schedule_reconnection_after_error(error, pid_type, state) do
    message = error.message
    connection_mode = set_connection_status_error(message, pid_type, state)

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

  defp set_connection_status_error(error_message, :lock_connection, state) do
    StatusMonitor.mark_pg_lock_as_errored(state.stack_id, error_message)
    "lock_connection"
  end

  defp set_connection_status_error(error_message, :replication_client, state) do
    StatusMonitor.mark_replication_client_as_errored(state.stack_id, error_message)
    "replication"
  end

  defp set_connection_status_error(error_message, pid_type, state)
       when pid_type in [:pools, :admin_pool, :snapshot_pool] do
    roles =
      case pid_type do
        :admin_pool -> [:admin]
        :snapshot_pool -> [:snapshot]
        :pools -> [:admin, :snapshot]
      end

    for role <- roles do
      StatusMonitor.mark_connection_pool_as_errored(state.stack_id, role, error_message)
    end

    "connection_pool"
  end

  defp set_connection_status_error(_error_message, _pid_type, _state) do
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

  defp drop_slot_and_restart(%DbConnectionError{drop_slot_and_restart?: true} = error, state) do
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

  defp replication_connection_opts(state),
    do: Keyword.fetch!(state.replication_opts, :connection_opts)

  defp pooled_connection_opts(state), do: state.connection_opts

  defp drop_slot(%State{pool_pids: %{admin: {pool_pid, _}}} = state) when is_pid(pool_pid) do
    pool = pool_name(state.stack_id, :admin)
    publication_name = Keyword.fetch!(state.replication_opts, :publication_name)
    slot_name = Keyword.fetch!(state.replication_opts, :slot_name)
    slot_temporary? = Keyword.fetch!(state.replication_opts, :slot_temporary?)

    if !slot_temporary? do
      execute_and_log_errors(pool, "SELECT pg_drop_replication_slot('#{slot_name}');")
    end

    execute_and_log_errors(pool, "DROP PUBLICATION #{publication_name}")
  end

  defp drop_slot(_state) do
    Logger.warning("Skipping slot drop, pool connection not available")
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

  # If the reason is of the form {:shutdown, reason}, we strip the :shutdown tuple
  # wrapper to get to the actual reason.
  defp strip_shutdown_atom({:shutdown, reason}), do: reason
  defp strip_shutdown_atom(reason), do: reason

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
    do: {:lock_connection, %{state | lock_connection_pid: nil}}

  defp nillify_pid(%State{replication_client_pid: pid} = state, pid),
    do: {:replication_client, %{state | replication_client_pid: nil}}

  defp nillify_pid(%State{pool_pids: %{admin: {pid, _}} = pool_pids} = state, pid),
    do: {:admin_pool, %{state | pool_pids: %{pool_pids | admin: nil}}}

  defp nillify_pid(%State{pool_pids: %{snapshot: {pid, _}} = pool_pids} = state, pid),
    do: {:snapshot_pool, %{state | pool_pids: %{pool_pids | snapshot: nil}}}

  defp nillify_timer(%State{lock_connection_timer: tref} = state, tref),
    do: %{state | lock_connection_timer: nil}

  defp nillify_timer(%State{replication_client_timer: tref} = state, tref),
    do: %{state | replication_client_timer: nil}

  defp nillify_timer(state, _tref), do: state

  defp validated_conn_opts_config_key(type), do: {__MODULE__, {:validated_connection_opts, type}}
end
