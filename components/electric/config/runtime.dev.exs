import Config

config :logger, level: :debug

auth_provider = System.get_env("AUTH_MODE", "secure") |> Electric.Satellite.Auth.build_provider!()
config :electric, Electric.Satellite.Auth, provider: auth_provider

proxy_port = System.get_env("PG_PROXY_PORT", "65432") |> String.to_integer()

proxy_password =
  System.get_env("PG_PROXY_PASSWORD", "password")

config :electric, Electric.Replication.Connectors,
  postgres_1: [
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
    connection: [
      host: ~c"localhost",
      port: 54321,
      database: ~c"electric",
      username: ~c"electric",
      password: ~c"password",
      replication: ~c"database",
      ssl: false
    ],
    replication: [
      electric_connection: [
        host: "host.docker.internal",
        port: 5433,
        dbname: "test"
      ]
    ],
    proxy: [
      # listen opts are ThousandIsland.options()
      # https://hexdocs.pm/thousand_island/ThousandIsland.html#t:options/0
      listen: [
        port: proxy_port
      ],
      password: proxy_password,
      log_level: :info
    ]
  ]

enable_proxy_tracing? = System.get_env("PROXY_TRACING_ENABLE", "false") in ["yes", "true"]

config :electric, Electric.Postgres.Proxy.Handler.Tracing, enable: enable_proxy_tracing?
