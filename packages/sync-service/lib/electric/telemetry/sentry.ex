defmodule Electric.Telemetry.Sentry do
  @enabled? Electric.telemetry_enabled?()

  if @enabled? do
    def add_logger_handler do
      :logger.add_handler(:electric_sentry_handler, Sentry.LoggerHandler, %{
        config: %{metadata: :all, capture_log_messages: true, level: :error}
      })
    end
  else
    def add_logger_handler, do: :ok
  end

  @spec set_tags_context(keyword()) :: :ok

  if @enabled? do
    def set_tags_context(tags) do
      Sentry.Context.set_tags_context(Map.new(tags))
    end
  else
    def set_tags_context(_tags), do: :ok
  end
end
