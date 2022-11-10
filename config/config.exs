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
  metadata: [
    :connection,
    :origin,
    :pid,
    :pg_client,
    :pg_producer,
    :pg_slot,
    :sq_client,
    :vx_consumer,
    :vx_producer,
    :cluster_id,
    :client_id,
    :user_id
  ]

config :logger,
  handle_otp_reports: true,
  handle_sasl_reports: true,
  level: :debug

config :electric, Electric.Replication.Postgres,
  pg_client: Electric.Replication.Postgres.Client,
  producer: Electric.Replication.Postgres.LogicalReplicationProducer

config :electric, Electric.StatusPlug, port: 5050

config :electric, Electric.Satellite.Auth, provider: {Electric.Satellite.Auth.Insecure, []}

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{Mix.env()}.exs"
