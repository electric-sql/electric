import Config

config :burn, Burn.Adapters.Anthropic,
  models: [
    opus: "claude-3-5-haiku-20241022",
    sonnet: "claude-3-5-haiku-20241022"
  ]

config :phoenix_sync,
  env: :test,
  mode: :sandbox,
  repo: Burn.Repo

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :burn, Burn.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "burn_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :burn, BurnWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "/95YqOMfgqb6gP/0O3chbE8Hz2bcPAdvlWjf0nLZ6BUeuTYnoGjGgA7ux8eX5Suc",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# # Enable helpful, but potentially expensive runtime checks
# config :phoenix_live_view,
#   enable_expensive_runtime_checks: true
