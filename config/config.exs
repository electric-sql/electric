# This file is responsible for configuring your application
# and its dependencies with the aid of the Mix.Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :sasl,
  errlog_type: :error,
  sasl_error_logger: false

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [
    :pg_producer,
    :pg_client,
    :connection,
    :vx_consumer,
    :vx_producer,
    :pg_slot,
    :origin,
    :sq_client
  ],
  handle_otp_reports: true,
  handle_sasl_reports: true

config :electric, Electric.Replication.Postgres,
  pg_client: Electric.Replication.Postgres.Client,
  producer: Electric.Replication.Postgres.LogicalReplicationProducer

config :electric, Electric.StatusPlug, port: 5050

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{Mix.env()}.exs"
