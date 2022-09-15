if System.get_env("INTEGRATION") do
  ExUnit.configure(capture_log: true, exclude: :test, include: :integration)
else
  Mox.defmock(Electric.Replication.MockPostgresClient, for: Electric.Replication.Postgres.Client)
  ExUnit.configure(exclude: :integration)
  Logger.configure(level: :info)
end

File.rm(
  Keyword.fetch!(
    Application.get_env(:electric, Electric.Replication.OffsetStorage),
    :file
  )
)

ExUnit.start()
