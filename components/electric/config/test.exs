import Config

config :electric, Electric.Replication.OffsetStorage, file: "./offset_storage_data.test.dat"

config :electric, Electric.VaxRepo, hostname: "localhost", port: 8087
