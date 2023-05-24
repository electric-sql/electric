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
      publication: "all_tables",
      slot: "all_changes",
      electric_connection: [
        host: "host.docker.internal",
        port: 5433,
        dbname: "test"
      ]
    ]
  ]

config :electric,
  global_cluster_id: System.get_env("GLOBAL_CLUSTER_ID", "dev.electric-db"),
  instance_id: System.get_env("ELECTRIC_INSTANCE_ID", "instance-1.region-1.dev.electric-db"),
  regional_id: System.get_env("ELECTRIC_REGIONAL_ID", "region-1.dev.electric-db")

config :logger, level: :debug
