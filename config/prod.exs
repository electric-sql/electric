import Config

config :electric, Electric.Replication.OffsetStorage, file: "./vx_pg_offset_storage_prod.dat"

# Do not print debug messages in production
config :logger, level: :info
