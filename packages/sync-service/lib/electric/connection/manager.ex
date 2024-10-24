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
         electric_instance_id: ...,
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
      # Database connection pool options
      :pool_opts,
      # Options specific to `Electric.Timeline`
      :timeline_opts,
      # Options passed to the Shapes.Supervisor's start_link() function
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
      :backoff,
      # Flag indicating whether the lock on the replication has been acquired
      :pg_lock_acquired,
      # PostgreSQL server version
      :pg_version,
      # Electric instance ID is used for connection process labeling
      :electric_instance_id,
      # PostgreSQL system identifier
      :pg_system_identifier,
      # PostgreSQL timeline ID
      :pg_timeline_id,
      :tenant_id
    ]
  end

  use GenServer

  require Logger

  @type status :: :waiting | :starting | :active

  @type option ::
          {:electric_instance_id, atom | String.t()}
          | {:connection_opts, Keyword.t()}
          | {:replication_opts, Keyword.t()}
          | {:pool_opts, Keyword.t()}
          | {:timeline_opts, Keyword.t()}
          | {:shape_cache_opts, Keyword.t()}

  @type options :: [option]

  @lock_status_logging_interval 10_000

  @spec start_link(options) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
  end

  def name(electric_instance_id, tenant_id) do
    Electric.Application.process_name(electric_instance_id, tenant_id, __MODULE__)
  end

  def name(opts) do
    electric_instance_id = Keyword.fetch!(opts, :electric_instance_id)
    tenant_id = Keyword.fetch!(opts, :tenant_id)
    name(electric_instance_id, tenant_id)
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

  def exclusive_connection_lock_acquired(server) do
    GenServer.cast(server, :exclusive_connection_lock_acquired)
  end

  def pg_info_looked_up(server, pg_info) do
    GenServer.cast(server, {:pg_info_looked_up, pg_info})
  end

  @impl true
  def init(opts) do
    # Because child processes are started via `start_link()` functions and due to how Postgrex
    # (mis)manages connection errors, we have to trap exists in the manager process to
    # implement our custom error handling logic.
    Process.flag(:trap_exit, true)

    connection_opts =
      opts
      |> Keyword.fetch!(:connection_opts)
      |> update_ssl_opts()
      |> update_tcp_opts()

    replication_opts =
      opts
      |> Keyword.fetch!(:replication_opts)
      |> Keyword.put(:start_streaming?, false)
      |> Keyword.put(:connection_manager, self())

    pool_opts = Keyword.fetch!(opts, :pool_opts)
    timeline_opts = Keyword.fetch!(opts, :timeline_opts)
    shape_cache_opts = Keyword.fetch!(opts, :shape_cache_opts)

    state =
      %State{
        connection_opts: connection_opts,
        replication_opts: replication_opts,
        pool_opts: pool_opts,
        timeline_opts: timeline_opts,
        shape_cache_opts: shape_cache_opts,
        pg_lock_acquired: false,
        backoff: {:backoff.init(1000, 10_000), nil},
        electric_instance_id: Keyword.fetch!(opts, :electric_instance_id),
        tenant_id: Keyword.fetch!(opts, :tenant_id)
      }

    # Try to acquire the connection lock on the replication slot
    # before starting shape and replication processes, to ensure
    # a single active sync service is connected to Postgres per slot.
    {:ok, state, {:continue, :start_lock_connection}}
  end

  @impl true
  def handle_call(:get_pg_version, _from, %{pg_version: pg_version} = state) do
    # If we haven't queried the PG version by the time it is requested, that's a fatal error.
    false = is_nil(pg_version)
    {:reply, pg_version, state}
  end

  def handle_call(:get_status, _from, %{pg_lock_acquired: pg_lock_acquired} = state) do
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

  @impl true
  def handle_continue(:start_lock_connection, %State{lock_connection_pid: nil} = state) do
    case Electric.Postgres.LockConnection.start_link(
           connection_opts: state.connection_opts,
           connection_manager: self(),
           lock_name: Keyword.fetch!(state.replication_opts, :slot_name)
         ) do
      {:ok, lock_connection_pid} ->
        Process.send_after(self(), :log_lock_connection_status, @lock_status_logging_interval)
        {:noreply, %{state | lock_connection_pid: lock_connection_pid}}

      {:error, reason} ->
        handle_connection_error(reason, state, "lock_connection")
    end
  end

  def handle_continue(:start_replication_client, %State{replication_client_pid: nil} = state) do
    opts =
      state
      |> Map.take([:electric_instance_id, :tenant_id, :replication_opts, :connection_opts])
      |> Map.to_list()

    case start_replication_client(opts) do
      {:ok, pid, connection_opts} ->
        state = %{state | replication_client_pid: pid, connection_opts: connection_opts}

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
          Electric.Postgres.ReplicationClient.start_streaming(pid)
          {:noreply, state}
        end

      {:error, reason} ->
        handle_connection_error(reason, state, "replication")
    end
  end

  def handle_continue(:start_connection_pool, state) do
    case start_connection_pool(state.connection_opts, state.pool_opts) do
      {:ok, pool_pid} ->
        # Checking the timeline continuity to see if we need to purge all shapes persisted so far.
        check_result =
          Electric.Timeline.check(
            {state.pg_system_identifier, state.pg_timeline_id},
            state.timeline_opts
          )

        shape_cache_opts =
          state.shape_cache_opts
          |> Keyword.put(:purge_all_shapes?, check_result == :timeline_changed)

        {:ok, shapes_sup_pid} =
          Electric.Connection.Supervisor.start_shapes_supervisor(
            electric_instance_id: state.electric_instance_id,
            tenant_id: state.tenant_id,
            shape_cache_opts: shape_cache_opts
          )

        # Everything is ready to start accepting and processing logical messages from Postgres.
        Electric.Postgres.ReplicationClient.start_streaming(state.replication_client_pid)

        # Remember the shape log collector pid for later because we want to tie the replication
        # client's lifetime to it.
        log_collector_pid = lookup_log_collector_pid(shapes_sup_pid)
        Process.monitor(log_collector_pid)

        state = %{state | pool_pid: pool_pid, shape_log_collector_pid: log_collector_pid}
        {:noreply, state}

      {:error, reason} ->
        handle_connection_error(reason, state, "regular")
    end
  end

  @impl true
  def handle_info({:timeout, tref, step}, %{backoff: {backoff, tref}} = state) do
    state = %{state | backoff: {backoff, nil}}
    handle_continue(step, state)
  end

  # When the replication client exits on its own, it can be restarted independently of the lock
  # connection and the DB pool. If any of the latter two shut down, Connection.Manager will
  # itself terminate to be restarted by its supervisor in a clean state.
  def handle_info({:EXIT, pid, reason}, %State{replication_client_pid: pid} = state) do
    halt_if_fatal_error!(reason)
    {:noreply, %{state | replication_client_pid: nil}, {:continue, :start_replication_client}}
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

  def handle_info({:DOWN, _ref, :process, pid, _reason}, %{shape_log_collector_pid: pid} = state) do
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
      _ = Electric.Postgres.ReplicationClient.stop(state.replication_client_pid)
    catch
      :exit, _reason ->
        # The replication client has already exited, so nothing else to do here.
        state
    end

    {:noreply, %{state | shape_log_collector_pid: nil}}
  end

  # Periodically log the status of the lock connection until it is acquired for
  # easier debugging and diagnostics.
  def handle_info(:log_lock_connection_status, state) do
    if not state.pg_lock_acquired do
      Logger.warning(fn -> "Waiting for postgres lock to be acquired..." end)
      Process.send_after(self(), :log_lock_connection_status, @lock_status_logging_interval)
    end

    {:noreply, state}
  end

  @impl true
  def handle_cast(:exclusive_connection_lock_acquired, %{pg_lock_acquired: false} = state) do
    # As soon as we acquire the connection lock, we try to start the replication connection
    # first because it requires additional privileges compared to regular "pooled" connections,
    # so failure to open a replication connection should be reported ASAP.
    {:noreply, %{state | pg_lock_acquired: true}, {:continue, :start_replication_client}}
  end

  def handle_cast({:pg_info_looked_up, {server_version, system_identifier, timeline_id}}, state) do
    {:noreply,
     %{
       state
       | pg_version: server_version,
         pg_system_identifier: system_identifier,
         pg_timeline_id: timeline_id
     }}
  end

  defp start_replication_client(opts) do
    case Electric.Postgres.ReplicationClient.start_link(opts) do
      {:ok, pid} ->
        {:ok, pid, Keyword.fetch!(opts, :connection_opts)}

      {:error, %Postgrex.Error{message: "ssl not available"}} = error ->
        sslmode = get_in(opts, [:connection_opts, :sslmode])

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

          opts
          |> Keyword.update!(:connection_opts, &Keyword.put(&1, :ssl, false))
          |> start_replication_client()
        end

      error ->
        error
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
      [backoff_type: :exp, max_restarts: 3, max_seconds: 5] ++
        pool_opts ++ Electric.Utils.deobfuscate_password(connection_opts)
    )
  end

  defp handle_connection_error(
         {:shutdown, {:failed_to_start_child, Electric.Postgres.ReplicationClient, error}},
         state,
         mode
       ) do
    handle_connection_error(error, state, mode)
  end

  defp handle_connection_error(error, state, mode) do
    halt_if_fatal_error!(error)

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

    step =
      cond do
        is_nil(state.lock_connection_pid) -> :start_lock_connection
        is_nil(state.replication_client_pid) -> :start_replication_client
        is_nil(state.pool_pid) -> :start_connection_pool
      end

    state = schedule_reconnection(step, state)
    {:noreply, state}
  end

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

  @invalid_slot_detail "This slot has been invalidated because it exceeded the maximum reserved size."

  defp halt_if_fatal_error!(
         %Postgrex.Error{
           postgres: %{
             code: :object_not_in_prerequisite_state,
             detail: @invalid_slot_detail,
             pg_code: "55000",
             routine: "StartLogicalReplication"
           }
         } = error
       ) do
    System.stop(1)
    exit(error)
  end

  defp halt_if_fatal_error!(_), do: nil

  defp schedule_reconnection(step, %State{backoff: {backoff, _}} = state) do
    {time, backoff} = :backoff.fail(backoff)
    tref = :erlang.start_timer(time, self(), step)
    Logger.warning("Reconnecting in #{inspect(time)}ms")
    %State{state | backoff: {backoff, tref}}
  end

  defp update_ssl_opts(connection_opts) do
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

  defp update_tcp_opts(connection_opts) do
    tcp_opts =
      if connection_opts[:ipv6] do
        [:inet6]
      else
        []
      end

    Keyword.put(connection_opts, :socket_options, tcp_opts)
  end

  defp lookup_log_collector_pid(shapes_supervisor) do
    {Electric.Replication.ShapeLogCollector, log_collector_pid, :worker, _modules} =
      shapes_supervisor
      |> Supervisor.which_children()
      |> List.keyfind(Electric.Replication.ShapeLogCollector, 0)

    log_collector_pid
  end
end
