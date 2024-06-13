defmodule Electric.Replication.PostgresConnectorSup do
  use Supervisor

  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.{CachedWal, Proxy}
  alias Electric.Replication.SatelliteCollectorProducer

  require Logger

  @spec start_link(Connectors.config()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(connector_config) do
    origin = Connectors.origin(connector_config)
    Supervisor.start_link(__MODULE__, connector_config, name: name(origin))
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  @impl Supervisor
  def init(connector_config) do
    origin = Connectors.origin(connector_config)

    logical_replication_producer = Postgres.LogicalReplicationProducer.name(origin)
    migration_consumer = Postgres.MigrationConsumer.name(origin)

    migration_consumer_opts = [
      producer: logical_replication_producer
    ]

    writer_module_opts = [
      conn_config: connector_config,
      producer: SatelliteCollectorProducer.name(origin)
    ]

    children = [
      {Electric.Postgres.Repo, Electric.Postgres.Repo.config(connector_config, [])},
      {Electric.Satellite.ClientReconnectionInfo, connector_config},
      {SchemaCache, connector_config},
      {SatelliteCollectorProducer, connector_config},
      {Postgres.LogicalReplicationProducer, connector_config},
      {Postgres.MigrationConsumer, {connector_config, migration_consumer_opts}},
      {Postgres.Writer, writer_module_opts},
      {CachedWal.EtsBacked,
       origin: origin,
       subscribe_to: [{migration_consumer, []}],
       wal_window_size: Connectors.get_wal_window_opts(connector_config).in_memory_size},
      {Proxy, connector_config: connector_config}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
