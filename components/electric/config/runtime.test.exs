import Config

alias Electric.Satellite.Auth

auth_config =
  Auth.Secure.build_config!(
    alg: "HS256",
    key: "test-signing-key-at-least-32-bytes-long",
    iss: "electric-sql-test-issuer"
  )

# it can be useful to turn on sasl_reports which ensure that stacktraces
# from crashed processes are outputted before the vm shuts down
# config :logger,
#   handle_otp_reports: true,
#   handle_sasl_reports: true

config :electric, Electric.Satellite.Auth, provider: {Auth.Secure, auth_config}

config :electric, disable_listeners: true
