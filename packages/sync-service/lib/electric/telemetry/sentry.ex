defmodule Electric.Telemetry.Sentry do
  use Electric.Telemetry

  @default_handler_id :electric_sentry_handler
  @default_config %{metadata: :all, capture_log_messages: true, level: :error}

  @spec add_logger_handler(keyword()) :: :ok | {:error, term()}
  @spec add_logger_handler() :: :ok | {:error, term()}
  def add_logger_handler(opts \\ [])

  with_telemetry Sentry.LoggerHandler do
    def add_logger_handler(opts) do
      {id, config_overrides} = Keyword.pop(opts, :id, @default_handler_id)
      config = Map.merge(@default_config, Map.new(config_overrides))
      :logger.add_handler(id, Sentry.LoggerHandler, %{config: config})
    end
  else
    def add_logger_handler(_opts), do: :ok
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
