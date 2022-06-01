import Config

# Configure your database
config :electric, Electric.Replication,
  epgsql: %{
    host: 'localhost',
    port: 54321,
    database: 'electric',
    username: 'electric',
    password: 'password',
    replication: 'database',
    ssl: false
  },
  producer: Electric.Replication.Producer,
  publication: "all_tables",
  slot: "all_changes"

# Do not include metadata nor timestamps in development logs
config :logger, :console, format: "[$level] $message\n"
