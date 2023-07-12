# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

alias Electric.Satellite.Auth

auth_provider =
  if config_env() == :test do
    auth_config =
      Auth.Secure.build_config!(
        alg: "HS256",
        key: "test-signing-key-at-least-32-bytes-long",
        iss: "electric-sql-test-issuer"
      )

    {Auth.Secure, auth_config}
  else
    case System.get_env("SATELLITE_AUTH_MODE", "secure") do
      "insecure" ->
        namespace = System.get_env("SATELLITE_AUTH_JWT_NAMESPACE")
        auth_config = Auth.Insecure.build_config(namespace: namespace)
        {Auth.Insecure, auth_config}

      "secure" ->
        auth_config =
          [
            alg: System.get_env("SATELLITE_AUTH_JWT_ALG"),
            key: System.get_env("SATELLITE_AUTH_JWT_KEY"),
            namespace: System.get_env("SATELLITE_AUTH_JWT_NAMESPACE"),
            iss: System.get_env("SATELLITE_AUTH_JWT_ISS"),
            aud: System.get_env("SATELLITE_AUTH_JWT_AUD")
          ]
          |> Enum.filter(fn {_, val} -> is_binary(val) and String.trim(val) != "" end)
          |> Auth.Secure.build_config!()

        {Auth.Secure, auth_config}

      other ->
        raise "Unsupported auth mode: #{inspect(other)}"
    end
  end

config :electric, Electric.Satellite.Auth, provider: auth_provider

config :electric,
  # Used only to send server identification upon connection,
  # can stay default while we're not working on multi-instance setups
  instance_id: System.get_env("ELECTRIC_INSTANCE_ID", "electric")

if config_env() == :prod do
  config :logger, level: String.to_existing_atom(System.get_env("LOG_LEVEL", "info"))

  config :electric, Electric.StatusPlug,
    port: System.get_env("STATUS_PORT", "5050") |> String.to_integer()

  publication = System.get_env("POSTGRES_PUBLICATION", "all_tables")
  slot = System.get_env("POSTGRES_SLOT", "all_changes")
  electric_host = System.get_env("ELECTRIC_HOST") || raise "Env variable ELECTRIC_HOST is not set"

  electric_port = System.get_env("POSTGRES_REPLICATION_PORT", "5433") |> String.to_integer()

  config :electric, Electric.PostgresServer, port: electric_port

  config :electric, Electric.Satellite.WsServer,
    port: System.get_env("WEBSOCKET_PORT", "5133") |> String.to_integer()

  connectors =
    System.get_env("CONNECTORS", "")
    |> String.split(";", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.map(&String.split(&1, "=", parts: 2))
    |> Enum.map(fn [name, "postgres" <> _ = connection_string] ->
      connection =
        PostgresqlUri.parse(connection_string)
        |> then(&Keyword.put(&1, :host, &1[:hostname]))
        |> Keyword.delete(:hostname)
        |> Keyword.put_new(:ssl, false)
        |> Keyword.update(:timeout, 5_000, &String.to_integer/1)

      {String.to_atom(name),
       producer: Electric.Replication.Postgres.LogicalReplicationProducer,
       connection: connection ++ [ssl: false, replication: "database"],
       replication: [
         publication: publication,
         slot: slot,
         electric_connection: [
           host: electric_host,
           port: electric_port,
           dbname: "test",
           connect_timeout: connection[:timeout]
         ]
       ]}
    end)

  config :electric, Electric.Replication.Connectors, connectors

  config :electric, Electric.Replication.OffsetStorage,
    file: System.get_env("OFFSET_STORAGE_FILE", "./offset_storage_data.dat")
end
