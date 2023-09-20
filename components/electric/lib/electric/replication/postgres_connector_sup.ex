defmodule Electric.Replication.PostgresConnectorSup do
  use Supervisor
  require Logger

  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.{CachedWal, Proxy}
  alias Electric.Replication.SatelliteCollectorProducer

  @spec start_link(Connectors.config()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(conn_config) do
    Supervisor.start_link(__MODULE__, conn_config)
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  @impl Supervisor
  def init(conn_config) do
    origin = Connectors.origin(conn_config)
    Electric.reg(name(origin))
    postgres_producer = Postgres.LogicalReplicationProducer.get_name(origin)
    postgres_producer_consumer = Postgres.MigrationConsumer.name(origin)

    children = [
      %{
        id: :postgres_schema_cache,
        start: {SchemaCache, :start_link, [conn_config]}
      },
      {SatelliteCollectorProducer, name: SatelliteCollectorProducer.name()},
      %{
        id: :postgres_producer,
        start: {Postgres.LogicalReplicationProducer, :start_link, [conn_config]}
      },
      %{
        id: :postgres_migration_consumer,
        start:
          {Postgres.MigrationConsumer, :start_link, [conn_config, [producer: postgres_producer]]}
      },
      {Postgres.SlotServer,
       conn_config: conn_config, producer: SatelliteCollectorProducer.name()},
      # Uses a globally registered name
      {CachedWal.EtsBacked, subscribe_to: [{postgres_producer_consumer, []}]},
      {Proxy,
       conn_config: conn_config,
       handler_config: [
         injector: [
           capture_mode: [
             # turn on the transparent capture mode to just log the client<->server messages
             # default: Electric.Postgres.Proxy.Injector.Capture.Transparent,
             default: nil,
             per_user: %{
               "prisma" => Electric.Postgres.Proxy.Injector.Capture.Prisma,
               "transparent" => Electric.Postgres.Proxy.Injector.Capture.Transparent
             }
           ]
         ]
       ]}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
