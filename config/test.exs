import Config

config :electric, Electric.Replication, producer: Broadway.DummyProducer

# Print only warnings and errors during test
config :logger, level: :warn
