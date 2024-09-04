defmodule Electric.ConnectionManager do
  @moduledoc """
  Custom initialisation and reconnection logic for database connections.

  This module is esentially a supervisor for database connections. But unlike an OTP process
  supervisor, it includes additional functionality:

    - adjusting connection options based on the response from the database
    - monitoring connections and initiating a reconnection procedure
    - custom reconnection logic with exponential backoff
    - starting the shape consumer supervisor tree once a replication connection
      has been established

  Your OTP application should start a singleton connection manager under its main supervision tree:

      children = [
        ...,
        {Electric.ConnectionManager,
         connection_opts: [...],
         replication_opts: [...],
         pool_opts: [...],
         log_collector: {LogCollector, [...]},
         shape_cache: {ShapeCache, [...]}}
        ...
      ]

      Supervisor.start_link(children, strategy: :one_for_one)
  """

  defmodule State do
    defstruct [
      # Database connection opts to be passed to Postgrex modules.
      :connection_opts,
      # Replication options specific to `Electric.Postgres.ReplicationClient`.
      :replication_opts,
      # Database connection pool options.
      :pool_opts,
      # Configuration for the log collector
      :log_collector,
      # Configuration for the shape cache that implements `Electric.ShapeCacheBehaviour`
      :shape_cache,
      # PID of the replication client.
      :replication_client_pid,
      # PID of the database connection pool (a `Postgrex` process).
      :pool_pid,
      # Backoff term used for reconnection with exponential back-off.
      :backoff
    ]
  end

  use GenServer

  require Logger

  @type option ::
          {:connection_opts, Keyword.t()}
          | {:replication_opts, Keyword.t()}
          | {:pool_opts, Keyword.t()}
          | {:log_collector, {module(), Keyword.t()}}
          | {:shape_cache, {module(), Keyword.t()}}

  @type options :: [option]

  @name __MODULE__

  @spec start_link(options) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: @name)
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

    pool_opts = Keyword.fetch!(opts, :pool_opts)

    state =
      %State{
        connection_opts: connection_opts,
        replication_opts: replication_opts,
        pool_opts: pool_opts,
        log_collector: Keyword.fetch!(opts, :log_collector),
        shape_cache: Keyword.fetch!(opts, :shape_cache),
        backoff: {:backoff.init(1000, 10_000), nil}
      }

    # We try to start the replication connection first because it requires additional
    # priveleges compared to regular "pooled" connections, so failure to open a replication
    # connection should be reported ASAP.
    {:ok, state, {:continue, :start_replication_client}}
  end

  @impl true
  def handle_continue(:start_replication_client, state) do
    case start_replication_client(state) do
      {:ok, _pid} ->
        # we wait for the working connection_opts to come back from the replication client
        # see `handle_call({:connection_opts, pid, connection_opts}, _, _)`
        {:noreply, state}

      {:error, reason} ->
        handle_connection_error(reason, state, "replication")
    end
  end

  # if the replication client is brought down by an error in one of the shape
  # consumers it will reconnect and re-send this message, so we just ignore
  # attempts to start the connection pool when it's already running
  def handle_continue(:start_connection_pool, %{pool_pid: pool_pid} = state)
      when is_pid(pool_pid) do
    if Process.alive?(pool_pid) do
      {:noreply, state}
    else
      # unlikely since the pool is linked to this process... but why not
      Logger.debug(fn -> "Restarting connection pool" end)
      {:noreply, %{state | pool_pid: nil}, {:continue, :start_connection_pool}}
    end
  end

  def handle_continue(:start_connection_pool, state) do
    case start_connection_pool(state.connection_opts, state.pool_opts) do
      {:ok, pid} ->
        # Now we have everything ready to start accepting and processing logical messages from
        # Postgres.
        Electric.Postgres.ReplicationClient.start_streaming(state.replication_client_pid)

        state = %{state | pool_pid: pid}
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

  # When either the replication client or the connection pool shuts down, let the OTP
  # supervisor restart the connection manager to initiate a new connection procedure from a clean
  # slate. That is, unless the error that caused the shutdown is unrecoverable and requires
  # manual resolution in Postgres. In that case, we crash the whole server.
  def handle_info({:EXIT, pid, reason}, state) do
    halt_if_fatal_error!(reason)

    tag =
      cond do
        pid == state.replication_client_pid -> :replication_connection
        pid == state.pool_pid -> :database_pool
      end

    {:stop, {tag, reason}, state}
  end

  def handle_info({:DOWN, _ref, :process, pid, reason}, %{replication_client_pid: pid} = state) do
    halt_if_fatal_error!(reason)

    # The replication client will be restarted automatically by the
    # Electric.Shapes.Supervisor so we can just carry on here.
    {:noreply, %{state | replication_client_pid: nil}}
  end

  @impl true
  def handle_cast({:connection_opts, pid, connection_opts}, state) do
    Process.monitor(pid)
    state = %{state | replication_client_pid: pid, connection_opts: connection_opts}

    case state do
      %{pool_pid: nil} ->
        {:noreply, state, {:continue, :start_connection_pool}}

      %{pool_pid: pool_pid} when is_pid(pool_pid) ->
        # The replication client has crashed and been restarted. Since we have
        # a db pool already start the replication stream.
        Electric.Postgres.ReplicationClient.start_streaming(pid)
        {:noreply, state}
    end
  end

  defp start_replication_client(state) do
    Electric.Shapes.Supervisor.start_link(
      replication_client: {
        Electric.Postgres.ReplicationClient,
        connection_opts: state.connection_opts,
        replication_opts: state.replication_opts,
        connection_manager: self()
      },
      shape_cache: state.shape_cache,
      log_collector: state.log_collector
    )
  end

  defp start_connection_pool(connection_opts, pool_opts) do
    # Use default backoff strategy for connections to prevent pool from shutting down
    # in the case of a connection error. Deleting a shape while its still generating
    # its snapshot from the db can trigger this as the snapshot process and the storage
    # process are both terminated when the shape is removed.
    #
    # See https://github.com/electric-sql/electric/issues/1554
    Postgrex.start_link(
      [backoff_type: :exp, max_restarts: 3, max_seconds: 5] ++ pool_opts ++ connection_opts
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
end
