import Config

config :electric, Electric.Replication.Vaxine.DownstreamPipeline,
  hostname: "vaxine_1",
  port: 8088

config :electric, Electric.VaxRepo,
  hostname: "vaxine_1",
  port: 8087

config :electric, Electric.Replication.Connectors,
  postgres_3: [
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
    connection: [
      host: 'pg_3',
      port: 5432,
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
        host: "electric_2",
        port: 5433,
        dbname: "test"
      ]
    ]
  ]

config :logger, backends: [:console], level: :debug

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:client, :connection, :slot, :origin]
