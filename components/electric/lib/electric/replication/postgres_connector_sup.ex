defmodule Electric.Replication.PostgresConnectorSup do
  use Electric, :supervisor

  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.{CachedWal, Proxy}
  alias Electric.Replication.SatelliteCollectorProducer

  require Logger

  @impl Supervisor
  def init(connector_config) do
    reg(connector_config)

    origin = Connectors.origin(connector_config)

    conn_opts = Connectors.get_connection_opts(connector_config)

    repo_config =
      [
        name: Electric.Postgres.Repo.name(origin),
        hostname: conn_opts.host,
        port: conn_opts.port,
        username: conn_opts.username,
        password: conn_opts.password,
        database: conn_opts.database,
        ssl: conn_opts.ssl == :required,
        pool_size: 10,
        log: false
      ]

    logical_replication_producer = Postgres.LogicalReplicationProducer.reg_name(origin)
    migration_consumer = Postgres.MigrationConsumer.reg_name(origin)

    write_to_pg_mode = Connectors.write_to_pg_mode(connector_config)

    migration_consumer_opts = [
      producer: logical_replication_producer,
      refresh_subscription: write_to_pg_mode == :logical_replication
    ]

    writer_module_args = {connector_config, producer: SatelliteCollectorProducer.reg_name(origin)}

    children = [
      {Electric.Postgres.Repo, Electric.Postgres.Repo.config(connector_config, [])},
      {Electric.Satellite.ClientReconnectionInfo, connector_config},
      {SchemaCache, connector_config},
      {SatelliteCollectorProducer, connector_config},
      {Postgres.LogicalReplicationProducer, connector_config},
      {Postgres.MigrationConsumer, {connector_config, migration_consumer_opts}},
      if write_to_pg_mode == :logical_replication do
        {Postgres.SlotServer, writer_module_args}
      else
        {Postgres.Writer, writer_module_args}
      end,
      {CachedWal.EtsBacked,
       origin: origin,
       subscribe_to: [{migration_consumer, []}],
       wal_window_size: Connectors.get_wal_window_opts(connector_config).in_memory_size},
      {Proxy, connector_config: connector_config}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
