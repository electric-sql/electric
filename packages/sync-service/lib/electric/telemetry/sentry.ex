defmodule Electric.Telemetry.Sentry do
  def add_logger_handler do
    :logger.add_handler(:electric_sentry_handler, Sentry.LoggerHandler, %{
      config: %{metadata: :all}
    })
  end

  @doc """
  Adds metadata to the logger and also adds all the metadata as Sentry tags.
  This is a workaround for Sentry not supporting metadata to added to tags
  and is needed until this issue is fixed: https://github.com/getsentry/sentry-elixir/issues/827
  """
  @spec logger_metadata(Logger.metadata()) :: :ok
  def logger_metadata(opts) do
    Logger.metadata(opts)
    Sentry.set_tags_context(Map.new(opts))
  end
end
