defmodule Electric.Telemetry.Sentry do
  use Electric.Telemetry

  @default_handler_id :electric_sentry_handler

  @typedoc """
  Extra entries for the `Sentry.LoggerHandler` config map (e.g.
  `:discard_threshold`, `:sync_threshold`). Merged over the defaults at
  install time.
  """
  @type handler_opts :: [{atom(), term()}]

  def default_handler_id, do: @default_handler_id

  @spec add_logger_handler(atom(), handler_opts()) :: :ok | {:error, term()}
  @spec add_logger_handler(atom()) :: :ok | {:error, term()}
  @spec add_logger_handler() :: :ok | {:error, term()}
  def add_logger_handler(id \\ @default_handler_id, opts \\ [])

  with_telemetry Sentry.LoggerHandler do
    @default_config %{metadata: :all, capture_log_messages: true, level: :error}

    def add_logger_handler(id, opts) do
      config = Map.merge(@default_config, Map.new(opts))
      :logger.add_handler(id, Sentry.LoggerHandler, %{config: config})
    end
  else
    def add_logger_handler(_id, _opts), do: :ok
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
