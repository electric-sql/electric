import Config

config :api,
  auth_secret: "NFL5*0Bc#9U6E@tnmC&E7SUN6GwHfLmY",
  # Configure the proxy endpoint to route shape requests to the external Electric
  # sync service, which we assume in development is running on `localhost:3000`.
  electric_url: "http://localhost:3000"

# Configure your database
config :api, Api.Repo,
  username: "postgres",
  password: "password",
  hostname: "localhost",
  port: 54321,
  database: "electric",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

port = 4000

config :api, ApiWeb.Endpoint,
  # Binding to loopback ipv4 address prevents access from other machines.
  # Change to `ip: {0, 0, 0, 0}` to allow access from other machines.
  http: [ip: {127, 0, 0, 1}, port: port],
  check_origin: false,
  debug_errors: true,
  secret_key_base: "pVvBh/U565dk0DteMtnoCjwLcoZnMDU9QeQNVr0gvVtYUrF8KqoJeyn5YJ0EQudX"

# Configure the Electric.Phoenix.Gateway.Plug to route electric client requests
# via this application's `GET /proxy/v1/shape` endpoint.
config :electric_phoenix, electric_url: "http://localhost:#{port}/proxy"

# Do not include metadata nor timestamps in development logs
config :logger, :console, format: "[$level] $message\n"

# Set a higher stacktrace during development. Avoid configuring such
# in production as building large stacktraces may be expensive.
config :phoenix, :stacktrace_depth, 20

# Initialize plugs at runtime for faster development compilation
config :phoenix, :plug_init_mode, :runtime
