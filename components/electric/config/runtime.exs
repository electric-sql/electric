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

Code.require_file("runtime.#{config_env()}.exs", __DIR__)
