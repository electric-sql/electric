import Config

config :electric, Electric.VaxRepo, hostname: "localhost", port: 8087

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.dev.dat"

config :electric, Electric.Migrations,
  migration_file_name_suffix: "/postgres.sql",
  dir: System.get_env("MIGRATIONS_DIR", "./integration_tests/migrations/migration_schemas/")

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
  global_cluster_id: System.get_env("GLOBAL_CLUSTER_ID", "electric-development-cluster-0000")

config :logger, level: :debug

with {:ok, auth_key} <- System.fetch_env("SATELLITE_AUTH_SIGNING_KEY"),
     {:ok, auth_iss} <- System.fetch_env("SATELLITE_AUTH_SIGNING_ISS") do
  IO.puts("using JWT auth for issuer #{auth_iss}")

  config :electric, Electric.Satellite.Auth,
    provider: {Electric.Satellite.Auth.JWT, issuer: auth_iss, secret_key: auth_key}
else
  :error ->
    config :electric, Electric.Satellite.Auth, provider: {Electric.Satellite.Auth.Insecure, []}
end
