import Config

config :electric, Electric.Replication.VaxinePostgresOffsetStorage,
  file: "./vx_pg_offset_storage_prod.dat"

# Do not print debug messages in production
config :logger, level: :info

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:client, :connection, :slot, :origin]
