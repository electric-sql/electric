defmodule Electric.Replication.PostgresConnector do
  use Supervisor

  require Logger

  alias Electric.Replication.Connectors
  alias Electric.Replication.PostgresConnectorMng
  alias Electric.Replication.PostgresConnectorSup

  @spec start_link(Connectors.config()) :: Supervisor.on_start()
  def start_link(conn_config) do
    Supervisor.start_link(__MODULE__, conn_config)
  end

  @impl Supervisor
  def init(conn_config) do
    origin = Connectors.origin(conn_config)
    Electric.reg(name(origin))

    children = [
      # %{id: :sup, start: {PostgresConnectorSup, :start_link, [origin]}, type: :supervisor},
      %{id: :mng, start: {PostgresConnectorMng, :start_link, [conn_config]}}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end

  @spec start_children(Connectors.config()) :: :ok | {:error, term}
  def start_children(conn_config) do
    origin = Connectors.origin(conn_config)
    connector = name(origin)

    {:ok, _} =
      Supervisor.start_child(
        connector,
        %{
          id: :sup,
          start: {PostgresConnectorSup, :start_link, [conn_config]},
          type: :supervisor,
          restart: :temporary
        }
      )

    :ok
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
end
