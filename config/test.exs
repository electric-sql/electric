import Config

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.test.dat"

config :electric, Electric.VaxRepo, hostname: "localhost", port: 8087

config :electric, Electric.Replication.Postgres,
  producer: Broadway.DummyProducer,
  pg_client: Electric.Replication.MockPostgresClient

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

config :electric, Electric.Replication.SQConnectors,
  vaxine_hostname: "localhost",
  vaxine_port: 8088,
  vaxine_connection_timeout: 5000

config :electric, Electric.Migrations, migration_file_name_suffix: "/postgres.sql"

config :electric,
  global_cluster_id: "test.electric-db",
  instance_id: "instance-1.region-1.test.electric-db",
  regional_id: "region-1.test.electric-db"

config :electric, Electric.Satellite.Auth,
  provider:
    {Electric.Satellite.Auth.JWT,
     issuer: "dev.electric-db",
     secret_key: Base.decode64!("AgT/MeUiP3SKzw5gC6BZKXk4t1ulnUvZy2d/O73R0sQ=")}
