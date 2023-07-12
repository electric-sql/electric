import Config

config :electric, Electric.VaxRepo, hostname: "localhost", port: 8087

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.dev.dat"

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
      electric_connection: [
        host: "host.docker.internal",
        port: 5433,
        dbname: "test"
      ]
    ]
  ]

config :logger, level: :debug
