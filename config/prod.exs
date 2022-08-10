import Config

# Do not print debug messages in production
config :logger, level: :info

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:client, :connection, :slot, :origin]
