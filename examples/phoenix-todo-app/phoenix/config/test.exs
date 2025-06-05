import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :todo_phoenix, TodoPhoenix.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "todo_phoenix_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# Disable Phoenix.Sync during tests for faster execution
config :phoenix_sync,
  mode: :disabled

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :todo_phoenix, TodoPhoenixWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "nx0XdJXl/Qy6exp8iZBGhm0Z7lZlq4M2WnhWwZfo89xYK1SaJsSW2fDFMcNDYsVr",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime
