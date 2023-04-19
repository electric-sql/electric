import Config

config :electric, Electric.VaxRepo, hostname: "localhost", port: 8087

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.dev.dat"

config :electric, Electric.Migrations,
  migration_file_name_suffix: "/postgres.sql",
  # Currently unused in dev & likely to be soon removed, but must be set for now
  dir: System.get_env("MIGRATIONS_DIR", "./migrations")

config :electric, Electric.Replication.Connectors,
  postgres_1: [
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
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
      slot: "all_changes",
      electric_connection: [
        host: "host.docker.internal",
        port: 5433,
        dbname: "test"
      ]
    ],
    downstream: [
      producer: Electric.Replication.Vaxine.LogProducer,
      producer_opts: [
        vaxine_hostname: "localhost",
        vaxine_port: 8088,
        vaxine_connection_timeout: 5000
      ]
    ]
  ],
  postgres_2: [
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
    connection: [
      host: 'localhost',
      port: 54322,
      database: 'electric',
      username: 'electric',
      password: 'password',
      replication: 'database',
      ssl: false
    ],
    replication: [
      publication: "all_tables",
      slot: "all_changes",
      electric_connection: [
        host: "host.docker.internal",
        port: 5433,
        dbname: "test"
      ]
    ],
    downstream: [
      producer: Electric.Replication.Vaxine.LogProducer,
      producer_opts: [
        vaxine_hostname: "localhost",
        vaxine_port: 8088
      ]
    ]
  ]

config :electric, Electric.Replication.SQConnectors,
  vaxine_hostname: "localhost",
  vaxine_port: 8088,
  vaxine_connection_timeout: 5000

config :electric,
  global_cluster_id: System.get_env("GLOBAL_CLUSTER_ID", "dev.electric-db"),
  instance_id: System.get_env("ELECTRIC_INSTANCE_ID", "instance-1.region-1.dev.electric-db"),
  regional_id: System.get_env("ELECTRIC_REGIONAL_ID", "region-1.dev.electric-db")

config :logger, level: :debug

auth_provider =
  with {:ok, auth_key} <- System.fetch_env("SATELLITE_AUTH_SIGNING_KEY"),
       {:ok, auth_iss} <- System.fetch_env("SATELLITE_AUTH_SIGNING_ISS") do
    IO.puts("using JWT auth for issuer #{auth_iss}")

    if byte_size(auth_key) >= 32 do
      {Electric.Satellite.Auth.JWT, issuer: auth_iss, secret_key: auth_key}
    else
      IO.puts(
        IO.ANSI.format([
          :bright,
          :red,
          "SATELLITE_AUTH_SIGNING_KEY value needs to be 32 bytes or greater. Falling back to insecure auth"
        ])
      )

      {Electric.Satellite.Auth.Insecure, []}
    end
  else
    :error ->
      {Electric.Satellite.Auth.Insecure, []}
  end

config :electric, Electric.Satellite.Auth, provider: auth_provider
