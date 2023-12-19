defmodule Electric.Replication.PostgresConnectorMng do
  use GenServer

  alias Electric.Postgres.Extension
  alias Electric.Replication.Postgres.Client
  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.Connectors
  alias Electric.Postgres.OidDatabase

  require Logger

  defmodule State do
    defstruct [
      :origin,
      :connector_config,
      :conn_opts,
      :repl_opts,
      :write_to_pg_mode,
      :status,
      :backoff,
      :pg_connector_sup_monitor
    ]

    @type status :: :initialization | :establishing_repl_conn | :subscribing | :ready

    @type t() :: %__MODULE__{
            origin: Connectors.origin(),
            connector_config: Connectors.config(),
            conn_opts: Connectors.connection_opts(),
            repl_opts: %{
              publication: String.t(),
              slot: String.t(),
              subscription: String.t(),
              electric_connection: %{
                host: String.t(),
                port: :inet.port_number(),
                dbname: String.t()
              }
            },
            write_to_pg_mode: Electric.write_to_pg_mode(),
            status: status,
            backoff: term,
            pg_connector_sup_monitor: reference | nil
          }
  end

  @spec start_link(Connectors.config()) :: {:ok, pid} | :ignore | {:error, term}
  def start_link(connector_config) do
    GenServer.start_link(__MODULE__, connector_config, [])
  end

  @spec name(Connectors.config()) :: Electric.reg_name()
  def name(connector_config) when is_list(connector_config) do
    connector_config
    |> Connectors.origin()
    |> name()
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) do
    Electric.name(__MODULE__, origin)
  end

  @spec status(Connectors.origin()) :: State.status()
  def status(origin) do
    GenServer.call(name(origin), :status)
  end

  @spec connector_config(Connectors.origin()) :: Connectors.config()
  def connector_config(origin) do
    GenServer.call(name(origin), :connector_config)
  end

  @impl GenServer
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    name = name(origin)
    Electric.reg(name)

    Logger.metadata(origin: origin)
    Process.flag(:trap_exit, true)

    connector_config = preflight_connector_config(connector_config)

    state =
      reset_state(%State{
        origin: origin,
        connector_config: connector_config,
        conn_opts: Connectors.get_connection_opts(connector_config),
        repl_opts: Connectors.get_replication_opts(connector_config),
        write_to_pg_mode: Connectors.write_to_pg_mode(connector_config)
      })

    {:ok, state, {:continue, :init}}
  end

  defp reset_state(%State{} = state) do
    %State{
      state
      | backoff: {:backoff.init(1000, 10_000), nil},
        status: :initialization,
        pg_connector_sup_monitor: nil
    }
  end

  @impl GenServer
  def handle_continue(:init, state) do
    case initialize_postgres(state) do
      :ok ->
        state = %State{state | status: :establishing_repl_conn}
        {:noreply, state, {:continue, :establish_repl_conn}}

      {:error, {:ssl_negotiation_failed, _}} when state.conn_opts.ssl != :required ->
        state = fallback_to_nossl(state)
        {:noreply, state, {:continue, :init}}

      {:error, reason} = error ->
        Logger.error("Initialization of Postgres state failed with reason: #{inspect(error)}.")

        Electric.Errors.print_error(
          :conn,
          """
          Failed to initialize Postgres state:
            #{inspect(error, pretty: true, width: 120)}

          """,
          extra_error_description(reason)
        )

        {:noreply, schedule_retry(:init, state)}
    end
  end

  def handle_continue(:establish_repl_conn, %State{} = state) do
    case PostgresConnector.start_children(state.connector_config) do
      {:ok, sup_pid} ->
        Logger.info("Successfully initialized Postgres connector #{inspect(state.origin)}.")

        ref = Process.monitor(sup_pid)
        state = %State{state | status: :subscribing, pg_connector_sup_monitor: ref}
        {:noreply, state, {:continue, :subscribe}}

      :error ->
        {:noreply, schedule_retry(:establish_repl_conn, state)}
    end
  end

  def handle_continue(:subscribe, %State{write_to_pg_mode: :logical_replication} = state) do
    case start_subscription(state) do
      :ok -> {:noreply, %State{state | status: :ready}}
      {:error, _} -> {:noreply, schedule_retry(:subscribe, state)}
    end
  end

  def handle_continue(:subscribe, %State{write_to_pg_mode: :direct_writes} = state) do
    :ok = stop_subscription(state)
    {:noreply, %State{state | status: :ready}}
  end

  @impl GenServer
  def handle_call(:status, _from, state) do
    {:reply, state.status, state}
  end

  def handle_call(:connector_config, _from, state) do
    {:reply, state.connector_config, state}
  end

  @impl GenServer
  def handle_info({:timeout, tref, action}, %State{backoff: {_, tref}} = state) do
    handle_continue(action, state)
  end

  def handle_info(
        {:DOWN, ref, :process, pid, reason},
        %State{pg_connector_sup_monitor: ref} = state
      ) do
    if reason not in [:normal, :shutdown] do
      Logger.warning(
        "PostgresConnectorSup #{inspect(pid)} has exited with reason: #{inspect(reason)}"
      )
    end

    {:noreply, schedule_retry(:init, reset_state(state))}
  end

  def handle_info(msg, %State{} = state) do
    Logger.error("unhandled info msg: #{inspect(msg)}")
    {:noreply, state}
  end

  # -----------------------------------------------------------------------------

  if Mix.env() == :test do
    # When running unit tests, PostgresConnectorSup is started on demand and does not need to be monitored for restarts.
    defp schedule_retry(_, state), do: state
  else
    defp schedule_retry(msg, %State{backoff: {backoff, _}} = state) do
      {time, backoff} = :backoff.fail(backoff)
      tref = :erlang.start_timer(time, self(), msg)
      Logger.info("schedule retry: #{inspect(time)}")
      %State{state | backoff: {backoff, tref}}
    end
  end

  defp start_subscription(%State{origin: origin, conn_opts: conn_opts, repl_opts: repl_opts}) do
    Client.with_conn(conn_opts, fn conn ->
      Client.start_subscription(conn, repl_opts.subscription)
    end)
    |> case do
      :ok ->
        Logger.notice("subscription started for #{origin}")
        :ok

      error ->
        Logger.error("error while starting postgres subscription: #{inspect(error)}")
        error
    end
  end

  defp stop_subscription(%State{origin: origin, conn_opts: conn_opts, repl_opts: repl_opts}) do
    Client.with_conn(conn_opts, fn conn ->
      Client.stop_subscription(conn, repl_opts.subscription)
    end)
    |> case do
      :ok ->
        Logger.notice("subscription stopped for #{origin}")
        :ok

      {:error, {:error, :error, code, _reason, description, _c_stacktrace}} ->
        Logger.warning("couldn't stop postgres subscription: #{description} (code: #{code})")
        :ok
    end
  end

  def initialize_postgres(%State{origin: origin, conn_opts: conn_opts} = state) do
    Logger.debug(
      "Attempting to initialize #{origin}: #{conn_opts.username}@#{conn_opts.host}:#{conn_opts.port}"
    )

    Client.with_conn(conn_opts, fn conn ->
      with {:ok, versions} <- Extension.migrate(conn),
           :ok <- maybe_create_subscription(conn, state.write_to_pg_mode, state.repl_opts),
           {:ok, oids} <- Client.query_oids(conn),
           :ok <- OidDatabase.save_oids(oids) do
        Logger.info(
          "Successfully initialized origin #{origin} at extension version #{List.last(versions)}"
        )

        :ok
      end
    end)
  end

  defp maybe_create_subscription(conn, :logical_replication, repl_opts) do
    %{
      subscription: subscription,
      publication: publication,
      electric_connection: electric_connection
    } = repl_opts

    with {:ok, _name} <-
           Client.create_subscription(conn, subscription, publication, electric_connection) do
      :ok
    end
  end

  defp maybe_create_subscription(_conn, :direct_writes, _repl_opts), do: :ok

  def preflight_connector_config(connector_config) do
    {:ok, ip_addr} =
      connector_config
      |> Connectors.get_connection_opts()
      |> resolve_host_to_addr()

    update_in(connector_config, [:connection], fn conn_opts ->
      conn_opts
      |> Keyword.put(:nulls, [nil, :null, :undefined])
      |> Keyword.put(:ip_addr, ip_addr)
      |> maybe_add_inet6(ip_addr)
    end)
  end

  defp maybe_add_inet6(conn_opts, {_, _, _, _, _, _, _, _}),
    do: Keyword.put(conn_opts, :tcp_opts, [:inet6])

  defp maybe_add_inet6(conn_opts, _), do: conn_opts

  # Perform a DNS lookup for an IPv6 IP address, followed by a lookup for an IPv4 address in case the first one fails.
  #
  # This is done in order to obviate the need for specifying the exact protocol a given database is reachable over,
  # which is one less thing to configure.
  #
  # IPv6 lookups can still be disabled by setting DATABASE_USE_IPV6=false.
  defp resolve_host_to_addr(%{host: host, ipv6: true}) do
    with {:error, :nxdomain} <- :inet.getaddr(host, :inet6) do
      :inet.getaddr(host, :inet)
    end
  end

  defp resolve_host_to_addr(%{host: host, ipv6: false}) do
    :inet.getaddr(host, :inet)
  end

  defp fallback_to_nossl(state) do
    Logger.warning(
      "Falling back to trying an unencrypted connection to Postgres, since DATABASE_REQUIRE_SSL=false."
    )

    connector_config = put_in(state.connector_config, [:connection, :ssl], false)

    %State{
      state
      | connector_config: connector_config,
        conn_opts: Connectors.get_connection_opts(connector_config)
    }
  end

  defp extra_error_description(:invalid_authorization_specification) do
    """
    The database appears to have been configured to only accept connections
    encrypted with SSL. Make sure you configure Electric with
    DATABASE_REQUIRE_SSL=true.
    """
  end

  defp extra_error_description(reason)
       when reason in [:ssl_not_available, {:ssl_negotiation_failed, :closed}] do
    """
    The database appears to have been configured to reject connections
    encrypted with SSL. Double-check your database configuration or
    restart Electric with DATABASE_REQUIRE_SSL=false.
    """
  end

  defp extra_error_description(%MatchError{
         term: {:error, {:error, :error, _code, :insufficient_privilege, _msg, _c_stacktrace}}
       }) do
    """
    The Postgres role used by Electric does not have sufficient privileges.

    Electric needs to be able to create and manage its internal schema and to open a replication connection
    to the database. Make sure that the role included in DATABASE_URL has the CREATE ON DATABASE privilege
    and the REPLICATION role attribute.
    """
  end

  defp extra_error_description(_) do
    """
    Double-check the value of DATABASE_URL and make sure your database
    is running and can be reached using the connection URL in DATABASE_URL.
    """
  end
end
