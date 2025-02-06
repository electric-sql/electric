import Config

config :logger, level: :critical

config :electric_phoenix, Electric.Phoenix.LiveViewTest.Endpoint, []

config :electric_phoenix, Electric.Client, base_url: "http://localhost:3000"

config :electric,
  start_in_library_mode: true

config :sentry,
  environment_name: config_env(),
  client: Electric.Telemetry.SentryReqHTTPClient
