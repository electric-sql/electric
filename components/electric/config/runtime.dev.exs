import Config

config :logger, level: :debug

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

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.dev.dat"
