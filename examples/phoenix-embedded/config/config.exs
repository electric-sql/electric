# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :electric_phoenix_embedded,
  namespace: Electric.PhoenixEmbedded,
  ecto_repos: [Electric.PhoenixEmbedded.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

# Configures the endpoint
config :electric_phoenix_embedded, Electric.PhoenixEmbeddedWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [
      html: Electric.PhoenixEmbeddedWeb.ErrorHTML,
      json: Electric.PhoenixEmbeddedWeb.ErrorJSON
    ],
    layout: false
  ],
  pubsub_server: Electric.PhoenixEmbedded.PubSub,
  live_view: [signing_salt: "3LDNUnzb"]

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

config :electric,
  replication_stream_id: "phoenix_embedded"

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
