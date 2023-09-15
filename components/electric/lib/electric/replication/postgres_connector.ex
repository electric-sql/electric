defmodule Electric.Replication.PostgresConnector do
  @moduledoc """
  Root supervisor for a Postgres connector.

  A Postgres connector defines a supervision tree of processes that together orchestrate a connection to Postgres'
  outgoing logical replication stream, processing of incoming replication messages, updating the memory-only SchemaCache
  and emitting new transactions as GenStage events that are consumed by processes like
  `Electric.Satellite.WebsocketServer`.
  """
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
    conn_config
    |> name_from_conn_config()
    |> Electric.reg()

    [{PostgresConnectorMng, conn_config}]
    |> Supervisor.init(strategy: :one_for_all)
  end

  @spec start_main_supervisor(Connectors.config()) :: Supervisor.on_start_child()
  def start_main_supervisor(conn_config) do
    connector = name_from_conn_config(conn_config)
    Supervisor.start_child(connector, {PostgresConnectorSup, conn_config})
  end

  @doc """
  Returns list of all active PG connectors
  """
  @spec connectors() :: [String.t()]
  def connectors() do
    Electric.reg_names(__MODULE__)
  end

  @spec name_from_origin(Connectors.origin()) :: Electric.reg_name()
  def name_from_origin(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  def name_from_conn_config(conn_config) do
    conn_config |> Connectors.origin() |> name_from_origin()
  end
end
