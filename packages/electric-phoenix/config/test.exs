import Config

config :logger, level: :critical

config :electric_phoenix, Electric.Phoenix.LiveViewTest.Endpoint, []

config :electric_phoenix, Electric.Client, base_url: "http://localhost:3000"
