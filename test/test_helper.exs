if System.get_env("INTEGRATION") do
  ExUnit.configure(capture_log: true, exclude: :test, include: :integration)
else
  Mox.defmock(Electric.Replication.MockPostgresClient, for: Electric.Replication.PostgresClient)
  ExUnit.configure(exclude: :integration)
  Logger.configure(level: :warn)
end

ExUnit.start()
