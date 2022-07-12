import Config

config :electric, Electric.Replication,
  producer: Broadway.DummyProducer,
  pg_client: Electric.Replication.MockPostgresClient

config :electric, Electric.ReplicationServer.VaxineLogConsumer, producer: Broadway.DummyProducer

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
