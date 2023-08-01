import Config

postgresql_connection =
  System.fetch_env!("DATABASE_URL")
  |> PostgresqlUri.parse()
  |> then(&Keyword.put(&1, :host, &1[:hostname]))
  |> Keyword.delete(:hostname)
  |> Keyword.put_new(:ssl, false)
  |> Keyword.update(:timeout, 5_000, &String.to_integer/1)
  |> Keyword.put(:replication, "database")

pg_server_host =
  System.get_env("LOGICAL_PUBLISHER_HOST") ||
    raise("Env variable LOGICAL_PUBLISHER_HOST is not set")

pg_server_port = Application.fetch_env!(:electric, Electric.PostgresServer, :port)

connectors = [
  {"postgres_1",
   producer: Electric.Replication.Postgres.LogicalReplicationProducer,
   connection: postgresql_connection,
   replication: [
     electric_connection: [
       host: pg_server_host,
       port: pg_server_port,
       dbname: "electric",
       connect_timeout: postgresql_connection[:timeout]
     ]
   ]}
]

config :electric, Electric.Replication.Connectors, connectors

config :electric, Electric.Replication.OffsetStorage,
  file: System.get_env("OFFSET_STORAGE_FILE", "./offset_storage_data.dat")
