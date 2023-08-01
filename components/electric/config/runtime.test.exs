import Config

config :electric, Electric.Satellite.Auth,
  provider:
    {Electric.Satellite.Auth.Secure,
     Electric.Satellite.Auth.Secure.build_config!(
       alg: "HS256",
       key: "test-signing-key-at-least-32-bytes-long",
       iss: "electric-sql-test-issuer"
     )}

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.test.dat"
