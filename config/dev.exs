import Config

config :electric, Electric.Replication,
  pg_client: Electric.Replication.PostgresClient,
  producer: Electric.Replication.Producer

config :electric, Electric.ReplicationServer.VaxineLogConsumer,
  producer: Electric.ReplicationServer.VaxineLogProducer,
  hostname: "localhost",
  port: 8088

# Do not include metadata nor timestamps in development logs
config :logger, :console,
  format: "[$level] $metadata $message \n",
  metadata: [:client, :connection],
  level: :debug
