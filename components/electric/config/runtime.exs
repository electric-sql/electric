# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

default_log_level = "info"
default_instance_id = "electric"
default_auth_mode = "secure"
default_http_api_port = "5050"
default_ws_server_port = "5133"
default_pg_server_port = "5433"
default_offset_storage_path = "./offset_storage_data.dat"

###

config :logger,
  handle_otp_reports: true,
  handle_sasl_reports: false,
  level: System.get_env("LOG_LEVEL", default_log_level) |> String.to_existing_atom()

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
    :component,
    :instance_id,
    :client_id,
    :user_id,
    :metadata
  ]

config :electric,
  # Used only to send server identification upon connection,
  # can stay default while we're not working on multi-instance setups
  instance_id: System.get_env("ELECTRIC_INSTANCE_ID", default_instance_id)

config :electric, Electric.Replication.Postgres,
  pg_client: Electric.Replication.Postgres.Client,
  producer: Electric.Replication.Postgres.LogicalReplicationProducer

config :electric,
  http_api_port: System.get_env("HTTP_API_PORT", default_http_api_port) |> String.to_integer()

config :electric, Electric.Satellite.WsServer,
  port: System.get_env("WEBSOCKET_PORT", default_ws_server_port) |> String.to_integer()

pg_server_port =
  System.get_env("LOGICAL_PUBLISHER_PORT", default_pg_server_port) |> String.to_integer()

config :electric, Electric.PostgresServer, port: pg_server_port

# The :prod environment is inlined here because by default Mix won't copy any config/runtime.*.exs files when assembling
# a release, and we want a single configuration file in our release.
if config_env() == :prod do
  auth_provider =
    System.get_env("AUTH_MODE", default_auth_mode) |> Electric.Satellite.Auth.build_provider!()

  config :electric, Electric.Satellite.Auth, provider: auth_provider

  postgresql_connection =
    System.fetch_env!("DATABASE_URL")
    |> PostgresqlUri.parse()
    |> then(&Keyword.put(&1, :host, &1[:hostname]))
    |> Keyword.delete(:hostname)
    |> Keyword.put_new(:ssl, false)
    |> Keyword.update(:timeout, 5_000, &String.to_integer/1)
    |> Keyword.put(:replication, "database")

  pg_server_host =
    System.get_env("LOGICAL_PUBLISHER_HOST") ||
      raise("Env variable LOGICAL_PUBLISHER_HOST is not set")

  connectors = [
    {"postgres_1",
     producer: Electric.Replication.Postgres.LogicalReplicationProducer,
     connection: postgresql_connection,
     replication: [
       electric_connection: [
         host: pg_server_host,
         port: pg_server_port,
         dbname: "electric",
         connect_timeout: postgresql_connection[:timeout]
       ]
     ]}
  ]

  config :electric, Electric.Replication.Connectors, connectors

  config :electric, Electric.Replication.OffsetStorage,
    file: System.get_env("OFFSET_STORAGE_FILE", default_offset_storage_path)
else
  Code.require_file("runtime.#{config_env()}.exs", __DIR__)
end
