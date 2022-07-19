import Config

config :electric, Electric.Replication,
  pg_client: Electric.Replication.PostgresClient,
  producer: Electric.Replication.Producer

config :electric, Electric.ReplicationServer.VaxineLogConsumer,
  producer: Electric.ReplicationServer.VaxineLogProducer,
  hostname: "localhost",
  port: 8088

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


# Do not include metadata nor timestamps in development logs
config :logger, :console,
  format: "[$level] $metadata $message \n",
  level: :debug,
  metadata: [:client, :connection, :slot, :origin]
