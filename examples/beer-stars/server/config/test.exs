import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :beer_stars, BeerStars.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "stars_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: 10

# Don't loop automatically in test.
config :beer_stars, BeerStars.Worker, should_start: false

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :beer_stars, BeerStarsWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "jEOR+grfyOsOz7LR+ReBti3yhGIuCc44zsPduZqU4nrLwKj7PAbajaRekqDcj38v",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime
