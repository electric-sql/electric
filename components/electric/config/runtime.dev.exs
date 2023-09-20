import Config

config :logger, level: :debug

config :electric,
  num_http_acceptors: 2,
  num_pg_acceptors: 2

auth_provider = System.get_env("AUTH_MODE", "secure") |> Electric.Satellite.Auth.build_provider!()
config :electric, Electric.Satellite.Auth, provider: auth_provider

config :electric, Electric.Replication.Connectors,
  postgres_1: [
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
    connection: [
      host: ~c"localhost",
      port: 54321,
      database: ~c"electric",
      username: ~c"electric",
      password: ~c"password",
      replication: ~c"database",
      ssl: false
    ],
    replication: [
      electric_connection: [
        host: "host.docker.internal",
        port: 5433,
        dbname: "test"
      ]
    ]
  ]
