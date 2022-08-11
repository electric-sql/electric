# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

if config_env() == :prod do
  vaxine_hostname =
    System.get_env("VAXINE_HOSTNAME") || raise "Env variable VAXINE_HOSTNAME is not set"

  vaxine_connection_timeout =
    System.get_env("VAXINE_CONNECTION_TIMEOUT", "5000") |> String.to_integer()

  config :electric, Electric.Replication.Vaxine.DownstreamPipeline,
    hostname: vaxine_hostname,
    port: 8088,
    connection_timeout: vaxine_connection_timeout

  config :electric, Electric.VaxRepo,
    hostname: vaxine_hostname,
    port: 8087

  publication = System.get_env("PUBLICATION", "all_tables")
  slot = System.get_env("SLOT", "all_changes")
  electric_host = System.get_env("ELECTRIC_HOST") || raise "Env variable ELECTRIC_HOST is not set"
  electric_port = System.get_env("ELECTRIC_PORT", "5433") |> String.to_integer()

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
           dbname: "test"
         ]
       ]}
    end)

  config :electric, Electric.Replication.Connectors, connectors
end
