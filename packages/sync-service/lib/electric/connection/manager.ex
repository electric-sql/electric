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

  defmodule State do
    defstruct [
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
      # Options specific to `Electric.Timeline`
      :timeline_opts,
      # Options passed to the Replication.Supervisor's start_link() function
      :shape_cache_opts,
      # PID of the replication client
      :replication_client_pid,
      # PID of the Postgres connection lock
      :lock_connection_pid,
      # PID of the database connection pool
      :pool_pid,
      # PID of the shape log collector
      :shape_log_collector_pid,
      # Backoff term used for reconnection with exponential back-off
      :connection_backoff,
      # Flag indicating whether the lock on the replication has been acquired
      :pg_lock_acquired,
      # This flag is set to true when the replication connection completes its setup procedure.
      :replication_connection_established,
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
      awaiting_active: [],
      drop_slot_requested: false,
      monitoring_started?: false
    ]
  end

  use GenServer
  alias Electric.Connection.Manager.ConnectionBackoff

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

  @connection_status_logging_interval 10_000

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
    name(Keyword.fetch!(opts, :stack_id))
  end

  @doc """
  Returns the version of the PostgreSQL server.
  """
  @spec get_pg_version(GenServer.server()) :: integer()
  def get_pg_version(server) do
    GenServer.call(server, :get_pg_version)
  end

  @doc """
  Returns the status of the connection manager.
  """
  @spec get_status(GenServer.server()) :: status()
  def get_status(server) do
    GenServer.call(server, :get_status)
  end

  @doc """
  Only returns once the status is `:active`.
  If the status is alredy active it returns immediately.
  This is useful if you need to the connection pool to be running before proceeding.
  """
  @spec await_active(GenServer.server()) :: :ok
  def await_active(server) do
    GenServer.call(server, :await_active)
  end

  def drop_replication_slot_on_stop(server) do
    GenServer.call(server, :drop_replication_slot_on_stop)
  end

  def exclusive_connection_lock_acquired(server) do
    GenServer.cast(server, :exclusive_connection_lock_acquired)
  end

  def replication_connection_initializing(server) do
    GenServer.cast(server, :replication_connection_initializing)
  end

  def replication_connection_established(server) do
    GenServer.cast(server, :replication_connection_established)
  end

  def pg_info_looked_up(server, pg_info) do
    GenServer.cast(server, {:pg_info_looked_up, pg_info})
  end

  def report_retained_wal_size(server) do
    GenServer.call(server, :report_retained_wal_size)
  end

  @impl true
  def init(opts) do
    # Because child processes are started via `start_link()` functions and due to how Postgrex
    # (mis)manages connection errors, we have to trap exists in the manager process to
    # implement our custom error handling logic.
    Process.flag(:trap_exit, true)

    Process.set_label({:connection_manager, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])

    pool_opts = Keyword.fetch!(opts, :pool_opts)
    timeline_opts = Keyword.fetch!(opts, :timeline_opts)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)

    state =
      %State{
        pool_opts: pool_opts,
        timeline_opts: timeline_opts,
        shape_cache_opts: shape_cache_opts,
        pg_lock_acquired: false,
        replication_connection_established: false,
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

    %State{
      state
      | shared_connection_opts: shared_connection_opts,
        connection_opts: connection_opts,
        replication_opts: replication_opts
    }
  end

  @impl true
  def handle_call(:get_pg_version, _from, %State{pg_version: pg_version} = state) do
    # If we haven't queried the PG version by the time it is requested, that's a fatal error.
    false = is_nil(pg_version)
    {:reply, pg_version, state}
  end

  def handle_call(:get_status, _from, %State{pg_lock_acquired: pg_lock_acquired} = state) do
    status =
      cond do
        not pg_lock_acquired ->
          :waiting

        is_nil(state.replication_client_pid) || is_nil(state.pool_pid) ||
            not Process.alive?(state.pool_pid) ->
          :starting

        true ->
          :active
      end

    {:reply, status, state}
  end

  def handle_call(:await_active, from, %State{pool_pid: nil} = state) do
    {:noreply, %State{state | awaiting_active: [from | state.awaiting_active]}}
  end

  def handle_call(:await_active, _from, state) do
    {:reply, :ok, state}
  end

  def handle_call(:drop_replication_slot_on_stop, _from, state) do
    {:reply, :ok, %State{state | drop_slot_requested: true}}
  end

  def handle_call(:report_retained_wal_size, _from, state) do
    if state.monitoring_started? do
      slot_name = Keyword.fetch!(state.replication_opts, :slot_name)
      query_and_report_retained_wal_size(state.pool_pid, slot_name, state.stack_id)
    end

    {:reply, :ok, state}
  end

  @impl true
  def handle_continue(:start_lock_connection, %State{lock_connection_pid: nil} = state) do
    opts = [
      connection_opts: connection_opts(state),
      connection_manager: self(),
      lock_name: Keyword.fetch!(state.replication_opts, :slot_name),
      stack_id: state.stack_id
    ]

    case start_lock_connection(opts) do
      {:ok, pid, connection_opts} ->
        state =
          %State{state | lock_connection_pid: pid}
          |> mark_connection_succeeded()
          |> update_connection_opts(connection_opts)

        Electric.StackSupervisor.dispatch_stack_event(
          state.stack_events_registry,
          state.stack_id,
          :waiting_for_connection_lock
        )

        schedule_periodic_connection_status_log(:log_lock_connection_status)

        {:noreply, state}

      {:error, reason} ->
        handle_connection_error(reason, state, "lock_connection")
    end
  end

  def handle_continue(
        :start_replication_client,
        %State{replication_connection_established: false} = state
      ) do
    opts = [
      replication_opts: replication_opts(state),
      connection_manager: self(),
      stack_id: state.stack_id
    ]

    # This function might be called multiple times due to the possibility of the noSSL
    # fallback. We want to do some of the steps on the first connection attempt only.
    first_time? = is_nil(state.replication_client_pid)

    if first_time?, do: Logger.debug("Starting replication client for stack #{state.stack_id}")

    case Electric.Postgres.ReplicationClient.start_link(opts) do
      {:ok, pid} ->
        state = %State{state | replication_client_pid: pid}

        if first_time?,
          do: schedule_periodic_connection_status_log(:log_replication_connection_status)

        {:noreply, state}

      {:error, reason} ->
        handle_connection_error(reason, state, "replication")
    end
  end

  def handle_continue(:start_connection_pool, state) do
    case start_connection_pool(connection_opts(state), state.pool_opts) do
      {:ok, pool_pid} ->
        state = mark_connection_succeeded(state)
        # Checking the timeline continuity to see if we need to purge all shapes persisted so far
        # and reset any replication related persistent state
        timeline_changed? =
          Electric.Timeline.check(
            {state.pg_system_identifier, state.pg_timeline_id},
            state.timeline_opts
          ) == :timeline_changed

        shape_cache_opts =
          state.shape_cache_opts
          |> Keyword.put(:purge_all_shapes?, timeline_changed?)

        if timeline_changed? do
          Electric.Replication.PersistentReplicationState.reset(
            stack_id: state.stack_id,
            persistent_kv: state.persistent_kv
          )

          Electric.LsnTracker.reset(state.stack_id)
        end

        shapes_sup_pid =
          case Electric.Connection.Supervisor.start_shapes_supervisor(
                 stack_id: state.stack_id,
                 shape_cache_opts: shape_cache_opts,
                 pool_opts: state.pool_opts,
                 replication_opts: state.replication_opts,
                 stack_events_registry: state.stack_events_registry,
                 tweaks: state.tweaks,
                 persistent_kv: state.persistent_kv
               ) do
            {:ok, shapes_sup_pid} ->
              shapes_sup_pid

            {:error, reason} ->
              Logger.error("Failed to start shape supervisor: #{inspect(reason)}")
              exit(reason)
          end

        # Everything is ready to start accepting and processing logical messages from Postgres.
        Electric.Postgres.ReplicationClient.start_streaming(state.replication_client_pid)

        # Remember the shape log collector pid for later because we want to tie the replication
        # client's lifetime to it.
        log_collector_pid = lookup_log_collector_pid(shapes_sup_pid)
        Process.monitor(log_collector_pid)

        state = %State{
          state
          | pool_pid: pool_pid,
            shape_log_collector_pid: log_collector_pid,
            monitoring_started?: true
        }

        for awaiting <- state.awaiting_active do
          GenServer.reply(awaiting, :ok)
        end

        {:noreply, %State{state | awaiting_active: []}}

      {:error, reason} ->
        handle_connection_error(reason, state, "regular")
    end
  end

  @impl true
  def handle_info(
        {:timeout, tref, step},
        %State{connection_backoff: {conn_backoff, tref}} = state
      ) do
    state = %State{state | connection_backoff: {conn_backoff, nil}}
    handle_continue(step, state)
  end

  # Special-case the explicit shutdown of the supervision tree
  def handle_info({:EXIT, _, :shutdown}, state), do: {:noreply, state}
  def handle_info({:EXIT, _, {:shutdown, _}}, state), do: {:noreply, state}

  # The replication client failed to establish its database connection.
  def handle_info(
        {:EXIT, pid, reason},
        %State{replication_client_pid: pid, replication_connection_established: false} = state
      ) do
    error = {:error, reason}
    conn_opts = Keyword.fetch!(replication_opts(state), :connection_opts)

    case maybe_fallback_to_no_ssl(error, conn_opts) do
      {:ok, conn_opts} ->
        state = update_replication_connection_opts(state, conn_opts)
        {:noreply, state, {:continue, :start_replication_client}}

      error ->
        handle_connection_error(error, state, "replication")
    end
  end

  # The replication client exited after it had already started streaming from the database.
  # It can be restarted independently of the lock connection and the DB pool. If any of the
  # latter two shut down, Connection.Manager will itself terminate to be restarted by its
  # supervisor in a clean state.
  def handle_info({:EXIT, pid, reason}, %State{replication_client_pid: pid} = state) do
    with false <- stop_if_fatal_error(reason, state) do
      Logger.debug(
        "Handling the exit of the replication client #{inspect(pid)} with reason #{inspect(reason)}"
      )

      state = %State{
        state
        | replication_client_pid: nil,
          replication_connection_established: false
      }

      state = schedule_reconnection(:start_replication_client, state)
      {:noreply, state}
    end
  end

  # The most likely reason for the lock connection or the DB pool to exit is the database
  # server going offline or shutting down. Stop Connection.Manager to allow its supervisor to
  # restart it in the initial state.
  def handle_info({:EXIT, pid, reason}, state) do
    Logger.warning(
      "#{inspect(__MODULE__)} is restarting after it has encountered an error in process #{inspect(pid)}:\n" <>
        inspect(reason, pretty: true) <> "\n\n" <> inspect(state, pretty: true)
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

    {:noreply, %State{state | shape_log_collector_pid: nil, replication_client_pid: nil}}
  end

  # Periodically log the status of the lock connection until it is acquired for
  # easier debugging and diagnostics.
  def handle_info(:log_lock_connection_status, state) do
    if not state.pg_lock_acquired do
      Logger.warning(fn -> "Waiting for postgres lock to be acquired..." end)
      schedule_periodic_connection_status_log(:log_lock_connection_status)
    end

    {:noreply, state}
  end

  # Periodically log the status of the replication connection while waiting for it to get ready
  # for streaming.
  def handle_info(:log_replication_connection_status, state) do
    if not state.replication_connection_established do
      Logger.warning(fn ->
        "Waiting for the replication connection setup to complete... " <>
          "Check that you don't have pending transactions in the database. " <>
          "Electric has to wait for all pending transactions to commit or rollback " <>
          "before it can create the replication slot."
      end)

      schedule_periodic_connection_status_log(:log_replication_connection_status)
    end

    {:noreply, state}
  end

  @impl true
  def handle_cast(:exclusive_connection_lock_acquired, %State{pg_lock_acquired: false} = state) do
    # As soon as we acquire the connection lock, we try to start the replication connection
    # first because it requires additional privileges compared to regular "pooled" connections,
    # so failure to open a replication connection should be reported ASAP.
    {:noreply, %State{state | pg_lock_acquired: true}, {:continue, :start_replication_client}}
  end

  def handle_cast(
        :replication_connection_initializing,
        %State{replication_connection_established: false} = state
      ) do
    state = mark_connection_succeeded(state)
    {:noreply, state}
  end

  def handle_cast(
        :replication_connection_established,
        %State{replication_connection_established: false} = state
      ) do
    state = %State{state | replication_connection_established: true}

    if is_nil(state.pool_pid) do
      # This is the case where Connection.Manager starts connections from the initial state.
      # Replication connection is opened after the lock connection has acquired the
      # exclusive lock. After it, we start the connection pool.
      false = is_nil(state.lock_connection_pid)
      {:noreply, state, {:continue, :start_connection_pool}}
    else
      # The replication client process exited while the other connection processes were
      # already running. Now that it's been restarted, we can transition it into the
      # logical replication mode immediately since all the other connection process and the
      # shapes supervisor are already up.
      false = is_nil(state.lock_connection_pid)
      Electric.Postgres.ReplicationClient.start_streaming(state.replication_client_pid)
      {:noreply, state}
    end
  end

  def handle_cast({:pg_info_looked_up, {server_version, system_identifier, timeline_id}}, state) do
    :telemetry.execute(
      [:electric, :postgres, :info_looked_up],
      %{
        pg_version: server_version,
        pg_system_identifier: system_identifier,
        pg_timeline_id: timeline_id
      },
      %{stack_id: state.stack_id}
    )

    {:noreply,
     %State{
       state
       | pg_version: server_version,
         pg_system_identifier: system_identifier,
         pg_timeline_id: timeline_id
     }}
  end

  defp start_lock_connection(opts) do
    case Electric.Postgres.LockConnection.start_link(opts) do
      {:ok, pid} ->
        {:ok, pid, opts[:connection_opts]}

      error ->
        with {:ok, connection_opts} <- maybe_fallback_to_no_ssl(error, opts[:connection_opts]) do
          opts = Keyword.put(opts, :connection_opts, connection_opts)
          start_lock_connection(opts)
        end
    end
  end

  defp start_connection_pool(connection_opts, pool_opts) do
    # Use default backoff strategy for connections to prevent pool from shutting down
    # in the case of a connection error. Deleting a shape while its still generating
    # its snapshot from the db can trigger this as the snapshot process and the storage
    # process are both terminated when the shape is removed.
    #
    # See https://github.com/electric-sql/electric/issues/1554
    Postgrex.start_link(
      pool_opts ++
        [
          backoff_type: :exp,
          max_restarts: 3,
          max_seconds: 5,
          # Assume the manager connection might be pooled, so use unnamed prepared
          # statements to avoid issues with the pooler
          #
          # See https://hexdocs.pm/postgrex/0.19.3/readme.html#pgbouncer
          prepare: :unnamed
        ] ++
        Electric.Utils.deobfuscate_password(connection_opts)
    )
  end

  defp maybe_fallback_to_ipv4(
         %DBConnection.ConnectionError{message: message, severity: :error} = error,
         connection_opts
       ) do
    # If network is unreachable, IPv6 is not enabled on the machine
    # If domain cannot be resolved, assume there is no AAAA record for it
    # Fall back to IPv4 for these cases
    if connection_opts[:ipv6] and
         String.starts_with?(message, "tcp connect (") and
         (String.ends_with?(message, "): non-existing domain - :nxdomain") or
            String.ends_with?(message, "): network is unreachable - :enetunreach")) do
      Logger.warning(
        "Database connection failed to find valid IPv6 address for #{connection_opts[:hostname]} - falling back to IPv4"
      )

      {:ok, connection_opts |> Keyword.put(:ipv6, false) |> populate_tcp_opts()}
    else
      {:error, error}
    end
  end

  defp maybe_fallback_to_ipv4(error, _connection_opts), do: {:error, error}

  defp maybe_fallback_to_no_ssl(
         {:error, %Postgrex.Error{message: "ssl not available"}} = error,
         connection_opts
       ) do
    sslmode = connection_opts[:sslmode]

    if sslmode == :require do
      error
    else
      if not is_nil(sslmode) do
        # Only log a warning when there's an explicit sslmode parameter in the database
        # config, meaning the user has requested a certain sslmode.
        Logger.warning(
          "Failed to connect to the database using SSL. Trying again, using an unencrypted connection."
        )
      end

      {:ok, Keyword.put(connection_opts, :ssl, false)}
    end
  end

  defp maybe_fallback_to_no_ssl(error, _connection_opts), do: error

  defp handle_connection_error(
         {:shutdown, {:failed_to_start_child, Electric.Postgres.ReplicationClient, error}},
         state,
         mode
       ) do
    handle_connection_error(error, state, mode)
  end

  defp handle_connection_error(
         %DBConnection.ConnectionError{severity: :error} = error,
         state,
         mode
       ) do
    conn_opts =
      if current_connection_step(state) == :start_replication_client do
        Keyword.fetch!(replication_opts(state), :connection_opts)
      else
        connection_opts(state)
      end

    case maybe_fallback_to_ipv4(error, conn_opts) do
      {:ok, conn_opts} ->
        # disable IPv6 and retry immediately
        state =
          if current_connection_step(state) == :start_replication_client do
            update_replication_connection_opts(state, conn_opts)
          else
            update_connection_opts(state, conn_opts)
          end

        step = current_connection_step(state)
        handle_continue(step, state)

      {:error, error} ->
        fail_on_error_or_reconnect(error, state, mode)
    end
  end

  defp handle_connection_error(error, state, mode) do
    fail_on_error_or_reconnect(error, state, mode)
  end

  # This separate function is needed for `handle_connection_error()` not to get stuck in a
  # recursive function call loop.
  defp fail_on_error_or_reconnect(error, state, mode) do
    with false <- stop_if_fatal_error(error, state) do
      state = schedule_reconnection_after_error(error, state, mode)
      {:noreply, state}
    end
  end

  defp schedule_reconnection_after_error(error, state, mode) do
    message =
      case error do
        %DBConnection.ConnectionError{message: message} ->
          message

        %Postgrex.Error{message: message} when not is_nil(message) ->
          message

        %Postgrex.Error{postgres: %{message: message} = pg_error} ->
          message <> pg_error_extra_info(pg_error)
      end

    Logger.warning("Database connection in #{mode} mode failed: #{message}")

    Electric.StackSupervisor.dispatch_stack_event(
      state.stack_events_registry,
      state.stack_id,
      {:database_connection_failed,
       %{
         message: message,
         total_retry_time: ConnectionBackoff.total_retry_time(elem(state.connection_backoff, 0))
       }}
    )

    step = current_connection_step(state)
    schedule_reconnection(step, state)
  end

  defp current_connection_step(%State{lock_connection_pid: nil}),
    do: :start_lock_connection

  defp current_connection_step(%State{replication_connection_established: false}),
    do: :start_replication_client

  defp current_connection_step(%State{pool_pid: nil}),
    do: :start_connection_pool

  defp pg_error_extra_info(pg_error) do
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

  defp stop_if_fatal_error(
         %Postgrex.Error{
           postgres: %{
             code: :object_not_in_prerequisite_state,
             detail: "This slot has been invalidated" <> _,
             pg_code: "55000"
           }
         } = error,
         state
       ) do
    dispatch_fatal_error_and_shutdown({:database_slot_invalidated, %{error: error}}, state)
  end

  defp stop_if_fatal_error(
         %Postgrex.Error{
           postgres: %{
             code: :internal_error,
             pg_code: "XX000"
           }
         } = error,
         state
       ) do
    if Regex.match?(~r/database ".*" does not exist$/, error.postgres.message) do
      dispatch_fatal_error_and_shutdown({:database_does_not_exist, %{error: error}}, state)
    else
      false
    end
  end

  defp stop_if_fatal_error(_, _), do: false

  defp dispatch_fatal_error_and_shutdown(error, state) do
    Electric.StackSupervisor.dispatch_stack_event(
      state.stack_events_registry,
      state.stack_id,
      error
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
    tref = :erlang.start_timer(time, self(), step)
    Logger.warning("Reconnecting in #{inspect(time)}ms")
    %State{state | connection_backoff: {conn_backoff, tref}}
  end

  defp mark_connection_succeeded(%State{connection_backoff: {conn_backoff, tref}} = state) do
    {total_retry_time, conn_backoff} = ConnectionBackoff.succeed(conn_backoff)

    if total_retry_time > 0 do
      Logger.info("Reconnection succeeded after #{inspect(total_retry_time)}ms")
    end

    %State{state | connection_backoff: {conn_backoff, tref}}
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

  defp update_connection_opts(%State{shared_connection_opts: nil} = state, conn_opts) do
    %State{state | connection_opts: conn_opts}
  end

  defp update_connection_opts(state, conn_opts) do
    %State{state | shared_connection_opts: conn_opts}
  end

  defp update_replication_connection_opts(%State{shared_connection_opts: nil} = state, conn_opts) do
    %State{state | replication_opts: put_in(state.replication_opts[:connection_opts], conn_opts)}
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

  defp query_and_report_retained_wal_size(pool, slot_name, stack_id) do
    query = """
    SELECT
      pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::int8
    FROM
      pg_replication_slots
    WHERE
      slot_name = $1
    """

    case Postgrex.query(pool, query, [slot_name]) do
      # The query above can return `-1` which I'm assuming means "up-to-date".
      # This is a confusing stat if we're measuring in bytes, so normalise to
      # [0, :infinity)
      {:ok, %Postgrex.Result{rows: [[wal_size]]}} ->
        :telemetry.execute([:electric, :postgres, :replication], %{wal_size: max(0, wal_size)}, %{
          stack_id: stack_id
        })

      {:error, error} ->
        Logger.warning("Failed to query retained WAL size\nError: #{inspect(error)}")
    end

    :ok
  end

  defp schedule_periodic_connection_status_log(type) do
    Process.send_after(self(), type, @connection_status_logging_interval)
  end

  defp connection_opts(%State{shared_connection_opts: nil} = state), do: state.connection_opts
  defp connection_opts(%State{shared_connection_opts: conn_opts}), do: conn_opts

  defp replication_opts(%State{shared_connection_opts: nil} = state), do: state.replication_opts

  defp replication_opts(%State{shared_connection_opts: conn_opts} = state),
    do: Keyword.put(state.replication_opts, :connection_opts, conn_opts)
end
