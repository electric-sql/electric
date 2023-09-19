if System.get_env("INTEGRATION") do
  ExUnit.configure(capture_log: true, exclude: :test, include: :integration)
else
  ExUnit.configure(capture_log: true, exclude: :integration, timeout: 15_000)
  Logger.configure(level: :info)
end

ExUnit.start()
