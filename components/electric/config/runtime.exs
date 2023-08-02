# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

config :logger,
  handle_otp_reports: true,
  handle_sasl_reports: false,
  level: System.get_env("LOG_LEVEL", "info") |> String.to_existing_atom()

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
  instance_id: System.get_env("ELECTRIC_INSTANCE_ID", "electric")

config :electric, Electric.Replication.Postgres,
  pg_client: Electric.Replication.Postgres.Client,
  producer: Electric.Replication.Postgres.LogicalReplicationProducer

alias Electric.Satellite.Auth

auth_provider =
  case System.get_env("AUTH_MODE", "secure") do
    "insecure" ->
      namespace = System.get_env("AUTH_JWT_NAMESPACE")
      auth_config = Auth.Insecure.build_config(namespace: namespace)
      {Auth.Insecure, auth_config}

    "secure" ->
      auth_config =
        [
          alg: System.get_env("AUTH_JWT_ALG"),
          key: System.get_env("AUTH_JWT_KEY"),
          namespace: System.get_env("AUTH_JWT_NAMESPACE"),
          iss: System.get_env("AUTH_JWT_ISS"),
          aud: System.get_env("AUTH_JWT_AUD")
        ]
        |> Enum.filter(fn {_, val} -> is_binary(val) and String.trim(val) != "" end)
        |> Auth.Secure.build_config!()

      {Auth.Secure, auth_config}

    other ->
      raise "Unsupported auth mode: #{inspect(other)}"
  end

config :electric, Electric.Satellite.Auth, provider: auth_provider

config :electric, http_api_port: System.get_env("HTTP_API_PORT", "5050") |> String.to_integer()

config :electric, Electric.Satellite.WsServer,
  port: System.get_env("WEBSOCKET_PORT", "5133") |> String.to_integer()

config :electric, Electric.PostgresServer,
  port: System.get_env("LOGICAL_PUBLISHER_PORT", "5433") |> String.to_integer()


# The :prod environment is inlined here because by default Mix won't copy any config/runtime.*.exs files when assembling
# a release, and we want a single configuration file in our release.
if config_env() == :prod do
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
