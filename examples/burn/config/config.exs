# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :burn,
  ecto_repos: [Burn.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

config :burn, Burn.Adapters.Anthropic,
  api_url: "https://api.anthropic.com/v1/messages",
  api_version: "2023-06-01",
  models: [
    opus: "claude-opus-4-20250514",
    sonnet: "claude-sonnet-4-20250514"
  ]

# Configures the endpoint
config :burn, BurnWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: BurnWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Burn.PubSub,
  live_view: [signing_salt: "DcrMg+jk"]

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Run Electric in embedded mode.
config :phoenix_sync,
  env: config_env(),
  mode: :embedded,
  repo: Burn.Repo

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
