import Config

config :api,
  ecto_repos: [Api.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

config :api, ApiWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: ApiWeb.ErrorJSON],
    layout: false
  ]

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
