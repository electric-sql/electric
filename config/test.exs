import Config

config :electric, Electric.Replication.VaxinePostgresOffsetStorage,
  file: "./vx_pg_offset_storage_test.dat"

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
