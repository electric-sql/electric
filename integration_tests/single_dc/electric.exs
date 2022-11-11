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
  global_cluster_id: "fake-global-id-for-tests"

config :electric, Electric.Satellite.Auth,
    provider:
      {Electric.Satellite.Auth.JWT,
       issuer: "dev.electric-sql.com",
       secret_key: Base.decode64!("AgT/MeUiP3SKzw5gC6BZKXk4t1ulnUvZy2d/O73R0sQ="),
       global_cluster_id: "fake-global-id-for-tests"}
