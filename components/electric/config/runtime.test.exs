import Config

alias Electric.Satellite.Auth

auth_config =
  Auth.Secure.build_config!(
    alg: "HS256",
    key: "test-signing-key-at-least-32-bytes-long",
    iss: "electric-sql-test-issuer"
  )

config :electric, Electric.Satellite.Auth, provider: {Auth.Secure, auth_config}

config :electric, disable_listeners: true

config :electric, Electric.Postgres.Proxy, port: 65431
