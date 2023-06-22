if System.get_env("INTEGRATION") do
  ExUnit.configure(capture_log: true, exclude: :test, include: :integration)
else
  Mox.defmock(Electric.Replication.MockPostgresClient, for: Electric.Replication.Postgres.Client)
  ExUnit.configure(capture_log: true, exclude: :integration, timeout: 5_000)
  Logger.configure(level: :info)
end

File.rm(
  Keyword.fetch!(
    Application.get_env(:electric, Electric.Replication.OffsetStorage),
    :file
  )
)

ExUnit.start()
