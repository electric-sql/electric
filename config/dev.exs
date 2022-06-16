import Config

# Configure your database
config :electric, Electric.Replication,
  pg_client: Electric.Replication.PostgresClient,
  producer: Electric.Replication.Producer

config :electric, Electric.Replication.PostgresClient,
  connection: [
    host: 'localhost',
    port: 54321,
    database: 'electric',
    username: 'electric',
    password: 'password',
    replication: 'database',
    ssl: false
  ],
  replication: [
    publication: "all_tables",
    slot: "all_changes"
  ]

# Do not include metadata nor timestamps in development logs
config :logger, :console, format: "[$level] $message\n"
