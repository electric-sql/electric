import Config

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.test.dat"

config :electric, Electric.VaxRepo, hostname: "localhost", port: 8087

config :electric,
  global_cluster_id: "test.electric-db",
  instance_id: "instance-1.region-1.test.electric-db",
  regional_id: "region-1.test.electric-db"

config :electric, Electric.Satellite.Auth,
  provider:
    {Electric.Satellite.Auth.JWT,
     issuer: "dev.electric-db",
     secret_key: Base.decode64!("AgT/MeUiP3SKzw5gC6BZKXk4t1ulnUvZy2d/O73R0sQ=")}
