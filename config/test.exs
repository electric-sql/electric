import Config

config :electric, Electric.Replication,
  producer: Broadway.DummyProducer,
  pg_client: Electric.Replication.MockPostgresClient

# Print only warnings and errors during test
config :logger, level: :warn
