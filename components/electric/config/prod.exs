import Config

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.prod.dat"

# Do not print debug messages in production
config :logger, level: :info
