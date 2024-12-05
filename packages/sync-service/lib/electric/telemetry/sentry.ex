defmodule Electric.Telemetry.Sentry do
  def add_logger_handler do
    :logger.add_handler(:electric_sentry_handler, Sentry.LoggerHandler, %{
      config: %{metadata: :all}
    })
  end
end
