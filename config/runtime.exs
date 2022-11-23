# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

if config_env() == :prod do
  config :electric, Electric.StatusPlug,
    port: System.get_env("STATUS_PORT", "5050") |> String.to_integer()

  vaxine_hostname = System.get_env("VAXINE_HOST") || raise "Env variable VAXINE_HOST is not set"

  vaxine_connection_timeout =
    System.get_env("VAXINE_CONNECTION_TIMEOUT", "5000") |> String.to_integer()

  vaxine_antidote_port = System.get_env("VAXINE_API_PORT", "8087") |> String.to_integer()

  vaxine_replication_port =
    System.get_env("VAXINE_REPLICATION_PORT", "8088") |> String.to_integer()

  config :electric, Electric.VaxRepo,
    hostname: vaxine_hostname,
    port: vaxine_antidote_port

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
       ],
       downstream: [
         producer: Electric.Replication.Vaxine.LogProducer,
         producer_opts: [
           vaxine_hostname: vaxine_hostname,
           vaxine_port: vaxine_replication_port,
           vaxine_connection_timeout: vaxine_connection_timeout
         ]
       ]}
    end)

  config :electric, Electric.Replication.Connectors, connectors

  config :electric, Electric.Replication.SQConnectors,
    vaxine_hostname: vaxine_hostname,
    vaxine_port: vaxine_replication_port,
    vaxine_connection_timeout: vaxine_connection_timeout

  config :electric, Electric.Replication.OffsetStorage,
    file: System.get_env("OFFSET_STORAGE_FILE", "./offset_storage_data.dat")

  config :electric, Electric.Migrations,
    dir: System.fetch_env!("MIGRATIONS_DIR"),
    migration_file_name_suffix: System.get_env("MIGRATIONS_FILE_NAME_SUFFIX", "/postgres.sql")

  # set to the database.cluster_slug
  global_cluster_id = System.fetch_env!("GLOBAL_CLUSTER_ID")

  config :electric,
    global_cluster_id: global_cluster_id

  # key = :crypto.strong_rand_bytes(32) |> Base.encode64()
  auth_secret_key = System.fetch_env!("SATELLITE_AUTH_SIGNING_KEY") |> Base.decode64!()

  # 🐉 DANGER: this "issuer" configuration *MUST* be the same
  # as the configuration in the console, currently under [:electric, :site_domain]
  # I'm hard-coding this in all envs ATM  for simplicity
  # if these config values do not match, the jwt token verification *will fail*
  # safe option is probably to just remove the `iss` field from the token
  config :electric, Electric.Satellite.Auth,
    provider:
      {Electric.Satellite.Auth.JWT,
       issuer: "electric-sql.com",
       secret_key: Base.decode64!("AgT/MeUiP3SKzw5gC6BZKXk4t1ulnUvZy2d/O73R0sQ="),
       global_cluster_id: global_cluster_id}
end
