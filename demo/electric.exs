import Config

config :electric, Electric.Replication,
  producer: Broadway.DummyProducer,
  pg_client: Electric.Replication.MockPostgresClient

config :electric, Electric.PostgresRepo,
  hostname: "db_a",
  port: 5432,
  database: "electric",
  username: "electric",
  password: "password"

config :electric, Electric.PostgresRepo2,
  hostname: "db_b",
  port: 5432,
  database: "electric",
  username: "electric",
  password: "password"
