defmodule Electric.Replication.PostgresConnector do
  use Supervisor

  require Logger

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnectorMng
  alias Electric.Replication.PostgresConnectorSup

  @spec start_link(Connectors.config()) :: Supervisor.on_start()
  def start_link(connector_config) do
    Supervisor.start_link(__MODULE__, connector_config)
  end

  @impl Supervisor
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    name = name(origin)
    Electric.reg(name)

    children = [%{id: :mng, start: {PostgresConnectorMng, :start_link, [connector_config]}}]
    Supervisor.init(children, strategy: :one_for_all)
  end

  @spec start_children(Connectors.config()) :: {:ok, pid} | :error
  def start_children(connector_config) do
    origin = Connectors.origin(connector_config)
    connector = name(origin)

    Supervisor.start_child(
      connector,
      %{
        id: :sup,
        start: {PostgresConnectorSup, :start_link, [connector_config]},
        type: :supervisor,
        restart: :temporary
      }
    )
    |> log_connector_sup_startup_error(connector_config)
  end

  @spec stop_children(Connectors.origin()) :: :ok | {:error, :not_found}
  def stop_children(origin) do
    connector = name(origin)
    Supervisor.terminate_child(connector, :sup)
  end

  @doc """
  Returns list of all active PG connectors
  """
  @spec connectors() :: [String.t()]
  def connectors() do
    Electric.reg_names(__MODULE__)
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  def connector_config do
    # NOTE(alco): Perhaps we can make this less hard-coded by requiring callers to pass the origin in as an argument.
    [{connector_name, _}] = Application.get_env(:electric, Electric.Replication.Connectors)

    connector_name
    |> to_string()
    |> connector_config()
  end

  @spec connector_config(Connectors.origin()) :: Connectors.config()
  def connector_config(origin) do
    PostgresConnectorMng.connector_config(origin)
  end

  defp log_connector_sup_startup_error({:ok, _sup_pid} = ok, _connector_config), do: ok

  defp log_connector_sup_startup_error(
         {:error, {{:shutdown, {:failed_to_start_child, child_id, reason}}, _supervisor_spec}},
         connector_config
       ) do
    Logger.error(
      "PostgresConnectorSup failed to start child #{inspect(child_id)} with reason: #{inspect(reason)}."
    )

    _ = log_child_error(child_id, reason, connector_config)
    :error
  end

  defp log_child_error(
         :postgres_producer,
         {:bad_return_value,
          {:error,
           {:error, :error, "55006", :object_in_use, "replication slot" <> _ = msg, _c_stacktrace}}},
         _connector_config
       ) do
    Electric.Errors.print_error(
      :conn,
      """
      Failed to establish replication connection to Postgres:
        #{msg}
      """,
      "Another instance of Electric appears to be connected to this database."
    )
  end

  defp log_child_error(
         :postgres_producer,
         {:bad_return_value, {:error, :wal_level_not_logical}},
         _connector_config
       ) do
    Electric.Errors.print_fatal_error(
      :dbconf,
      "Your Postgres database is not configured with wal_level=logical.",
      """
      Visit https://electric-sql.com/docs/usage/installation/postgres
      to learn more about Electric's requirements for Postgres.
      """
    )
  end

  defp log_child_error(
         {ThousandIsland, _proxy},
         {:shutdown, {:failed_to_start_child, :listener, :eaddrinuse}},
         connector_config
       ) do
    proxy_port = get_in(Connectors.get_proxy_opts(connector_config), [:listen, :port])

    Electric.Errors.print_error(
      :conn,
      "Failed to open a socket to listen for TCP connections on port #{proxy_port}.",
      "Another instance of Electric or a different application is already listening on the same port."
    )
  end
end
