defmodule Electric.Connection.Manager.ConnectionResolver do
  @doc false
  use GenServer, shutdown: :brutal_kill

  require Logger

  defmodule Connection do
    @moduledoc false
    @behaviour Postgrex.SimpleConnection

    def init(stack_id) do
      Logger.metadata(stack_id: stack_id, is_connection_process?: true)
      Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)
      {:ok, []}
    end

    def notify(_channel, _payload, _state) do
      :ok
    end
  end

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, stack_id} <- Keyword.fetch(opts, :stack_id) do
      GenServer.start_link(__MODULE__, opts, name: name(stack_id))
    end
  end

  def validate(stack_id, db_connection) do
    GenServer.call(name(stack_id), {:validate, db_connection}, :infinity)
  end

  @impl GenServer
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    # ignore exits from connection processes that fail to start due to
    # connection errors or from us killing the connection after we're
    # done
    Process.flag(:trap_exit, true)

    Process.set_label({:connection_resolver, stack_id})
    metadata = [is_connection_process?: true, stack_id: stack_id]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    {_m, _f, _a} =
      connection_mod =
      Keyword.get(opts, :connection_mod, {Postgrex.SimpleConnection, :start_link, []})

    {:ok, %{connection_mod: connection_mod, stack_id: stack_id}, {:continue, :notify_ready}}
  end

  @impl GenServer
  def handle_continue(:notify_ready, state) do
    :ok = Electric.Connection.Manager.connection_resolver_ready(state.stack_id)

    {:noreply, state}
  end

  @impl GenServer
  def handle_call({:validate, connection}, _from, state) do
    # convert to postgrex style for return to conn.manager
    connection = populate_connection_opts(connection)

    result = attempt_connection({:cont, connection}, state)

    {:reply, result, state, :hibernate}
  end

  @impl GenServer
  def handle_info(:shutdown, state) do
    {:stop, {:shutdown, :normal}, state}
  end

  # ignore connections exiting because of invalid config
  def handle_info({:EXIT, _pid, _reason}, state), do: {:noreply, state}

  defp attempt_connection({:cont, conn_opts}, state) do
    %{
      connection_mod: {connection_mod, connection_fun, connection_args}
    } = state

    connection_opts =
      Keyword.merge(Electric.Utils.deobfuscate_password(conn_opts),
        auto_reconnect: false,
        sync_connect: true
      )

    args = [Connection, state.stack_id, connection_opts | connection_args]

    case apply(connection_mod, connection_fun, args) do
      {:ok, conn} ->
        Process.exit(conn, :kill)

        {:ok, conn_opts}

      {:error, error} ->
        error
        |> mutate_based_on_error(conn_opts)
        |> attempt_connection(state)
    end
  end

  defp attempt_connection({:halt, error}, _state) do
    {:error, error}
  end

  defp populate_connection_opts(conn_opts) do
    conn_opts |> populate_ssl_opts() |> populate_tcp_opts() |> populate_socket_dir()
  end

  defp populate_ssl_opts(connection_opts) do
    ssl_opts =
      case connection_opts[:sslmode] do
        :disable ->
          false

        _ ->
          # Unix sockets don't use SSL
          if connection_opts[:socket_dir] do
            false
          else
            ssl_verify_opts(connection_opts[:hostname], connection_opts[:cacertfile])
          end
      end

    Keyword.put(connection_opts, :ssl, ssl_opts)
  end

  # Unless explicitly requested by the user, Electric doesn't perform server certificate
  # verification even when the database connection is encrypted. This mimics the behaviour of
  # psql with sslmode=prefer or sslmode=require.
  #
  # Here's an example of connecting to DigitalOcean's Managed PostgreSQL to illustrate the point.
  # Specifying sslmode=require does not result in certificate verification, it only instructs
  # psql to use SSL for encryption of the database connection:
  #
  #     $ psql 'postgresql://...?sslmode=require'
  #     psql (16.1, server 16.3)
  #     SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)
  #     Type "help" for help.
  #
  #     [db-postgresql-do-user-13160360-0] doadmin:defaultdb=> \q
  #
  # Now if we request certificate verification, we get a different result:
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
  # In Electric, specifying the path to a file containing trusted certificate(s) forces the
  # full verification to take place, equivalent to psql's sslmode=verify-full.
  defp ssl_verify_opts(hostname, nil) do
    # Even with `verify: :verify_none` we still need to include `server_name_indication`
    # since, for example, Neon relies on it being present in the client's TLS handshake.
    [
      verify: :verify_none,
      server_name_indication: String.to_charlist(hostname)
    ]
  end

  defp ssl_verify_opts(hostname, cacertfile_path) when is_binary(cacertfile_path) do
    [
      verify: :verify_peer,
      cacertfile: cacertfile_path,
      server_name_indication: String.to_charlist(hostname)
    ]
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

  defp populate_socket_dir(connection_opts) do
    case connection_opts[:socket_dir] do
      nil ->
        connection_opts

      socket_dir ->
        # When using Unix socket, we need to:
        # 1. Replace hostname with socket_dir
        # 2. Remove the port (not used with Unix sockets)
        connection_opts
        |> Keyword.delete(:hostname)
        |> Keyword.delete(:port)
        |> Keyword.put(:socket_dir, socket_dir)
    end
  end

  defp mutate_based_on_error(%Postgrex.Error{message: "ssl not available"} = error, conn_opts) do
    maybe_fallback_to_no_ssl(conn_opts, error)
  end

  defp mutate_based_on_error(
         %DBConnection.ConnectionError{message: "ssl connect: closed"} = error,
         conn_opts
       ) do
    maybe_fallback_to_no_ssl(conn_opts, error)
  end

  defp mutate_based_on_error(
         %DBConnection.ConnectionError{severity: :error} = error,
         conn_opts
       ) do
    maybe_fallback_to_ipv4(error, conn_opts)
  end

  defp mutate_based_on_error(error, _conn_opts) do
    {:halt, error}
  end

  defp maybe_fallback_to_no_ssl(conn_opts, error) do
    sslmode = conn_opts[:sslmode]

    if sslmode != :require and is_nil(conn_opts[:cacertfile]) do
      if not is_nil(sslmode) do
        # Only log a warning when there's an explicit sslmode parameter in the database
        # config, meaning the user has requested a certain sslmode.
        Logger.warning(
          "Failed to connect to the database using SSL. Trying again, using an unencrypted connection."
        )
      end

      {:cont, Keyword.put(conn_opts, :ssl, false)}
    else
      {:halt, error}
    end
  end

  defp maybe_fallback_to_ipv4(
         %DBConnection.ConnectionError{message: message, severity: :error} = error,
         conn_opts
       ) do
    # If network is unreachable, IPv6 is not enabled on the machine
    # If domain cannot be resolved, assume there is no AAAA record for it
    # Fall back to IPv4 for these cases
    if conn_opts[:ipv6] and
         String.starts_with?(message, "tcp connect (") and
         (String.ends_with?(message, "): non-existing domain - :nxdomain") or
            String.ends_with?(message, "): host is unreachable - :ehostunreach") or
            String.ends_with?(message, "): network is unreachable - :enetunreach")) do
      Logger.warning(
        "Database connection failed to find valid IPv6 address for #{conn_opts[:hostname]} - falling back to IPv4"
      )

      {:cont, conn_opts |> Keyword.put(:ipv6, false) |> populate_tcp_opts()}
    else
      {:halt, error}
    end
  end
end
