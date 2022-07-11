# This file is responsible for configuring your application
# and its dependencies with the aid of the Mix.Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :electric, Electric.VaxRepo, hostname: "localhost", port: 8087

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

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{Mix.env()}.exs"
