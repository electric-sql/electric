import Config

# Configure your database
config :electric, Electric.Replication,
  pg_client: Electric.Replication.PostgresClient,
  producer: Electric.Replication.Producer

# Do not include metadata nor timestamps in development logs
config :logger, :console,
  format: "[$level] $metadata $message \n",
  metadata: [:client, :connection]
