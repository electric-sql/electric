defmodule Electric.Telemetry.OpenTelemetry do
  require OpenTelemetry.SemanticConventions.Trace

  @typep span_name :: String.t()
  @typep span_attrs :: :opentelemetry.attributes_map()
  @typep span_ctx :: :opentelemetry.span_ctx()

  defguardp is_exception?(term)
            when is_map(term) and :erlang.is_map_key(:__struct__, term) and
                   is_atom(:erlang.map_get(:__struct__, term)) and
                   :erlang.is_map_key(:__exception__, term) and
                   :erlang.map_get(:__exception__, term) == true

  def setup do
    OpentelemetryEcto.setup(Electric.Postgres.Repo.telemetry_prefix(), db_statement: :enabled)
  end

  @spec with_span(span_name(), span_attrs(), (-> t)) :: t when t: term
  def with_span(name, attributes, fun)
      when is_binary(name) and (is_list(attributes) or is_map(attributes)) do
    span_opts = %{
      attributes: attributes,
      links: [],
      is_recording: true,
      start_time: :opentelemetry.timestamp(),
      kind: :internal
    }

    :otel_tracer.with_span(tracer(), name, span_opts, fn _span_ctx -> fun.() end)
  end

  @spec async_fun(span_ctx() | nil, span_name(), span_attrs(), (-> t)) :: (-> t) when t: term
  def async_fun(span_ctx \\ nil, name, attributes, fun)
      when is_binary(name) and (is_list(attributes) or is_map(attributes)) do
    wrap_fun_with_context(span_ctx, fn -> with_span(name, attributes, fun) end)
  end

  @spec add_span_attributes(span_ctx() | nil, span_attrs()) :: boolean()
  def add_span_attributes(span_ctx \\ nil, attributes) do
    span_ctx = span_ctx || get_current_context()
    :otel_span.set_attributes(span_ctx, attributes)
  end

  def record_exception(error, stacktrace \\ nil, attributes \\ []) do
    {type, message} =
      if is_exception?(error) do
        {to_string(error.__struct__), Exception.message(error)}
      else
        {"error", to_string(error)}
      end

    semantic_attributes = [
      {OpenTelemetry.SemanticConventions.Trace.exception_type(), type},
      {OpenTelemetry.SemanticConventions.Trace.exception_message(), message},
      {OpenTelemetry.SemanticConventions.Trace.exception_stacktrace(),
       Exception.format_stacktrace(stacktrace)}
    ]

    :otel_span.add_event(get_current_context(), "exception", semantic_attributes ++ attributes)
  end

  defp tracer, do: :opentelemetry.get_tracer()

  defp get_current_context do
    :otel_tracer.current_span_ctx()
  end

  # Set the span on otel_ctx of the current process to `span_ctx`, so that subsequent `with_span()`
  # calls are registered as its child.
  defp set_current_context(span_ctx) do
    :otel_tracer.set_current_span(span_ctx)
  end

  defp wrap_fun_with_context(span_ctx, fun) do
    span_ctx = span_ctx || get_current_context()

    fn ->
      set_current_context(span_ctx)
      fun.()
    end
  end
end
