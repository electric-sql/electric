defmodule Electric.Telemetry.Sentry do
  use Electric.Telemetry

  @default_handler_id :electric_sentry_handler

  @spec add_logger_handler(handler_id :: atom()) :: :ok | {:error, term()}
  @spec add_logger_handler() :: :ok | {:error, term()}
  def add_logger_handler(id \\ @default_handler_id)

  with_telemetry Sentry.LoggerHandler do
    def add_logger_handler(id) do
      :logger.add_handler(id, Sentry.LoggerHandler, %{
        config: %{metadata: :all, capture_log_messages: true, level: :error}
      })
    end
  else
    def add_logger_handler(_id), do: :ok
  end

  @spec set_tags_context(keyword()) :: :ok

  with_telemetry Sentry.Context do
    def set_tags_context(tags) do
      Sentry.Context.set_tags_context(Map.new(tags))
    end
  else
    def set_tags_context(_tags), do: :ok
  end
end
