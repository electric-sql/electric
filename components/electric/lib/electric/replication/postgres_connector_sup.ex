defmodule Electric.Replication.PostgresConnectorSup do
  use Supervisor
  require Logger

  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.{CachedWal, Proxy}
  alias Electric.Replication.SatelliteCollectorProducer

  @spec start_link(Connectors.config()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(connector_config) do
    Supervisor.start_link(__MODULE__, connector_config)
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  @impl Supervisor
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    name = name(origin)
    Electric.reg(name)

    postgres_producer = Postgres.LogicalReplicationProducer.get_name(origin)
    postgres_producer_consumer = Postgres.MigrationConsumer.name(origin)
    write_to_pg_mode = Connectors.write_to_pg_mode(connector_config)

    migration_consumer_opts = [
      producer: postgres_producer,
      refresh_subscription: write_to_pg_mode == :logical_replication
    ]

    writer_config = [conn_config: connector_config, producer: SatelliteCollectorProducer.name()]

    children = [
      %{
        id: :postgres_schema_cache,
        start: {SchemaCache, :start_link, [connector_config]}
      },
      {SatelliteCollectorProducer,
       name: SatelliteCollectorProducer.name(), write_to_pg_mode: write_to_pg_mode},
      %{
        id: :postgres_producer,
        start: {Postgres.LogicalReplicationProducer, :start_link, [connector_config]}
      },
      %{
        id: :postgres_migration_consumer,
        start:
          {Postgres.MigrationConsumer, :start_link, [connector_config, migration_consumer_opts]}
      },
      if write_to_pg_mode == :logical_replication do
        {Postgres.SlotServer, writer_config}
      else
        {Postgres.Writer, writer_config}
      end,
      # Uses a globally registered name
      {CachedWal.EtsBacked, subscribe_to: [{postgres_producer_consumer, []}]},
      {Proxy, connector_config: connector_config}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
