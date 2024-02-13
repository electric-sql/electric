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

  @status_key :status
  @connector_config_key :connector_config

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
    case :ets.lookup(ets_table_name(origin), @status_key) do
      [{@status_key, status}] -> status
      [] -> :initialization
    end
  end

  @spec connector_config(Connectors.origin()) :: Connectors.config()
  def connector_config(origin) do
    :ets.lookup_element(ets_table_name(origin), @connector_config_key, 2)
  end

  @impl GenServer
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    name = name(origin)
    Electric.reg(name)

    Logger.metadata(origin: origin)
    Process.flag(:trap_exit, true)

    # Use an ETS table to store data that are regularly looked up by other processes.
    :ets.new(ets_table_name(origin), [:protected, :named_table, :read_concurrency])

    state =
      %State{origin: origin, connector_config: connector_config}
      |> update_connector_config(&preflight_connector_config/1)
      |> reset_state()

    {:ok, state, {:continue, :init}}
  end

  defp ets_table_name(origin) do
    String.to_atom(inspect(__MODULE__) <> ":" <> origin)
  end

  defp reset_state(%State{} = state) do
    %State{
      state
      | backoff: {:backoff.init(1000, 10_000), nil},
        pg_connector_sup_monitor: nil
    }
    |> set_status(:initialization)
  end

  defp set_status(state, status) do
    :ets.insert(ets_table_name(state.origin), {@status_key, status})
    %{state | status: status}
  end

  defp update_connector_config(state, fun) do
    connector_config = fun.(state.connector_config)

    :ets.insert(ets_table_name(state.origin), {@connector_config_key, connector_config})

    %{
      state
      | connector_config: connector_config,
        conn_opts: Connectors.get_connection_opts(connector_config),
        repl_opts: Connectors.get_replication_opts(connector_config),
        write_to_pg_mode: Connectors.write_to_pg_mode(connector_config)
    }
  end

  @impl GenServer
  def handle_continue(:init, state) do
    case initialize_postgres(state) do
      :ok ->
        state = set_status(state, :establishing_repl_conn)
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
        state = %State{state | pg_connector_sup_monitor: ref} |> set_status(:subscribing)
        {:noreply, state, {:continue, :subscribe}}

      :error ->
        {:noreply, schedule_retry(:establish_repl_conn, state)}
    end
  end

  def handle_continue(:subscribe, %State{write_to_pg_mode: :logical_replication} = state) do
    case start_subscription(state) do
      :ok -> {:noreply, set_status(state, :ready)}
      {:error, _} -> {:noreply, schedule_retry(:subscribe, state)}
    end
  end

  def handle_continue(:subscribe, %State{write_to_pg_mode: :direct_writes} = state) do
    :ok = stop_subscription(state)
    {:noreply, set_status(state, :ready)}
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
           :ok <- OidDatabase.update_oids(conn) do
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

    Keyword.update!(connector_config, :connection, fn conn_opts ->
      conn_opts
      |> Keyword.put(:nulls, [nil, :null, :undefined])
      |> Keyword.put(:ip_addr, ip_addr)
      |> maybe_put_inet6(ip_addr)
      |> maybe_put_sni()
      |> maybe_verify_peer()
    end)
  end

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

  defp maybe_put_inet6(conn_opts, {_, _, _, _, _, _, _, _}),
    do: Keyword.put(conn_opts, :tcp_opts, [:inet6])

  defp maybe_put_inet6(conn_opts, _), do: conn_opts

  defp maybe_put_sni(conn_opts) do
    if conn_opts[:ssl] do
      sni_opt = {:server_name_indication, String.to_charlist(conn_opts[:host])}
      update_in(conn_opts, [:ssl_opts], &[sni_opt | List.wrap(&1)])
    else
      conn_opts
    end
  end

  defp maybe_verify_peer(conn_opts) do
    if conn_opts[:ssl] == :required do
      ssl_opts = get_verify_peer_opts()
      update_in(conn_opts, [:ssl_opts], &(ssl_opts ++ List.wrap(&1)))
    else
      conn_opts
    end
  end

  defp get_verify_peer_opts do
    case :public_key.cacerts_load() do
      :ok ->
        cacerts = :public_key.cacerts_get()
        Logger.info("Successfully loaded #{length(cacerts)} cacerts from the OS")

        [
          verify: :verify_peer,
          cacerts: cacerts,
          customize_hostname_check: [
            # Use a custom match function to support wildcard CN in server certificates.
            # For example, CN = *.us-east-2.aws.neon.tech
            match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
          ]
        ]

      {:error, reason} ->
        Logger.warning("Failed to load cacerts from the OS: #{inspect(reason)}")
        # We're not sure how reliable OS certificate stores are in general, so keep going even
        # if the loading of cacerts has failed. A warning will be logged every time a new
        # database connection is established without the `verify_peer` option, so the issue will be
        # visible to the developer.
        []
    end
  end

  defp fallback_to_nossl(state) do
    Logger.warning(
      "Falling back to trying an unencrypted connection to Postgres, since DATABASE_REQUIRE_SSL=false."
    )

    update_connector_config(state, &put_in(&1, [:connection, :ssl], false))
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
