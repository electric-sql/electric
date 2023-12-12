import Config

config :logger, level: :debug

auth_provider = System.get_env("AUTH_MODE", "secure") |> Electric.Satellite.Auth.build_provider!()
config :electric, Electric.Satellite.Auth, provider: auth_provider

config :electric, Electric.Postgres.Proxy.Handler.Tracing, colour: true
