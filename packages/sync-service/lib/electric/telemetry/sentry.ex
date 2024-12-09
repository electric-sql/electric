defmodule Electric.Telemetry.Sentry do
  def add_logger_handler do
    :logger.add_handler(:electric_sentry_handler, Sentry.LoggerHandler, %{
      config: %{metadata: :all}
    })
  end

  @spec set_tags_context(keyword()) :: :ok
  def set_tags_context(tags) do
    Sentry.Context.set_tags_context(Map.new(tags))
  end
end
