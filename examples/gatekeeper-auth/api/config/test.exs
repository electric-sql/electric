import Config

# Configure the proxy endpoint to route shape requests to the external Electric
# sync service, which we assume in test is running on `localhost:3002`.
config :api,
  auth_secret: "NFL5*0Bc#9U6E@tnmC&E7SUN6GwHfLmY",
  electric_url: "http://localhost:3000"

# Configure your database
config :api, Api.Repo,
  username: "postgres",
  password: "password",
  hostname: "localhost",
  port: 54321,
  database: "electric",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

port = 4002

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :api, ApiWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: port],
  secret_key_base: "FdsTo+z4sPEhsQNsUtBq26K9qn42nkn1OCH2cLURBZkPCvgJ4F3WiVNFo1NVjojw",
  server: false

# Configure the Electric.Phoenix.Gateway.Plug to route electric client requests
# via this application's `GET /proxy/v1/shape` endpoint.
config :electric_phoenix, electric_url: "http://localhost:#{port}/proxy"

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime
