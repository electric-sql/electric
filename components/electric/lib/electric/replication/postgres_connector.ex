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

  @ets_table :postgres_connector_table
  @conn_config_key :config

  @spec start_link(Connectors.config()) :: Supervisor.on_start()
  def start_link(conn_config) do
    # We can only have a single PostgresConnector alive at any time, so registering it under a static name is perfectly
    # reasonable.
    Supervisor.start_link(__MODULE__, conn_config, name: __MODULE__)
  end

  @impl Supervisor
  def init(conn_config) do
    conn_config
    |> name_from_conn_config()
    |> Electric.reg()

    :ets.new(@ets_table, [:named_table])
    store_config(conn_config)

    [
      {Electric.Postgres.ConnectionPool, conn_config},
      {PostgresConnectorMng, conn_config}
    ]
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

  defp store_config(config) do
    :ets.insert(@ets_table, {@conn_config_key, config})
  end

  def config do
    :ets.lookup_element(@ets_table, @conn_config_key, 2)
  end
end
