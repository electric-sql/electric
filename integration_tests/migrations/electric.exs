import Config

config :electric, Electric.VaxRepo,
  hostname: "vaxine_1",
  port: 8087

config :electric, Electric.Replication.Connectors,
  postgres_1: [
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
    connection: [
      host: 'pg_1',
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
        host: "electric_1",
        port: 5433,
        dbname: "test"
      ]
    ],
    downstream: [
      producer: Electric.Replication.Vaxine.LogProducer,
      producer_opts: [
        vaxine_hostname: "vaxine_1",
        vaxine_port: 8088
      ]
    ]
  ],

  postgres_2: [
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
    connection: [
      host: 'pg_2',
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
        host: "electric_1",
        port: 5433,
        dbname: "test"
      ]
    ],
    downstream: [
      producer: Electric.Replication.Vaxine.LogProducer,
      producer_opts: [
        vaxine_hostname: "vaxine_1",
        vaxine_port: 8088
      ]
    ]
  ]

config :electric, Electric.Replication.SQConnectors,
  vaxine_hostname: "vaxine_1",
  vaxine_port: 8088,
  vaxine_connection_timeout: 5000

config :logger, backends: [:console], level: :debug

config :electric,
  instance_id: "instance-a.region-1.test.electric-db",
  regional_id: "region-1.test.electric-db"

config :electric, Electric.Satellite.Auth, provider: {Electric.Satellite.Auth.Insecure, []}

config :electric, Electric.Migrations,
  dir: "/migrations",
  migration_file_name_suffix: "/postgres.sql"
