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

  @spec start_children(Connectors.config()) :: Supervisor.on_start_child()
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
end
