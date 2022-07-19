import Config

config :electric, Electric.Replication,
  producer: Broadway.DummyProducer,
  pg_client: Electric.Replication.MockPostgresClient

config :electric, Electric.ReplicationServer.VaxineLogConsumer, producer: Broadway.DummyProducer

config :electric, Electric.Replication.Connectors,
  postgres_1: [
    producer: Electric.Replication.Producer,
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
    ]
  ],
  postgres_2: [
    producer: Electric.Replication.Producer,
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
    ]
  ]


config :electric, Electric.PostgresRepo,
  hostname: "localhost",
  port: 54321,
  database: "electric",
  username: "electric",
  password: "password"

config :electric, Electric.PostgresRepo2,
  hostname: "localhost",
  port: 54322,
  database: "electric",
  username: "electric",
  password: "password"
