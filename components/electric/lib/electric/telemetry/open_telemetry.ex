defmodule Electric.Telemetry.OpenTelemetry do
  require OpenTelemetry.SemanticConventions.Trace

  @pt_tracer {__MODULE__, :tracer}

  defguardp is_exception?(term)
            when is_map(term) and :erlang.is_map_key(:__struct__, term) and
                   is_atom(:erlang.map_get(:__struct__, term)) and
                   :erlang.is_map_key(:__exception__, term) and
                   :erlang.map_get(:__exception__, term) == true

  def setup do
    OpentelemetryEcto.setup(Electric.Postgres.Repo.telemetry_prefix(), db_statement: :enabled)

    :persistent_term.put(@pt_tracer, :opentelemetry.get_application_tracer(__MODULE__))
  end

  defp tracer, do: :persistent_term.get(@pt_tracer)

  def with_span(name, attributes, fun) do
    :otel_tracer.with_span(tracer(), name, %{attributes: attributes}, fn _span_ctx -> fun.() end)
  end

  def async_fun(span_ctx \\ nil, name, attributes, fun) do
    wrap_fun_with_context(span_ctx, fn -> with_span(name, attributes, fun) end)
  end

  def get_current_context do
    :otel_tracer.current_span_ctx()
  end

  # Set the span on otel_ctx of the current process to `span_ctx`, so that subsequent `with_span()`
  # calls are registered as its child.
  def set_current_context(span_ctx) do
    :otel_tracer.set_current_span(span_ctx)
  end

  def wrap_fun_with_context(span_ctx \\ nil, fun) do
    span_ctx = span_ctx || get_current_context()

    fn ->
      set_current_context(span_ctx)
      fun.()
    end
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

  def handle_poller_event(event, measurements, _metadata, nil) do
    :otel_tracer.with_span(
      tracer(),
      span_name(event),
      %{attributes: span_attrs(event, measurements)},
      fn _span_ctx -> nil end
    )
  end

  defp span_name([:vm | tail]), do: Enum.join([:vm, :metrics | tail], ".")

  defp span_attrs([:vm, :uptime], %{total: elapsed}),
    do: %{"vm.uptime_s" => System.convert_time_unit(elapsed, :native, :second)}

  defp span_attrs([:vm, :memory], measurements),
    do: Map.new(measurements, fn {key, val} -> {"vm.memory.#{key}", val} end)

  defp span_attrs([:vm, :system_counts], measurements),
    do:
      Map.new(measurements, fn
        {:atom_count, val} -> {"vm.system_counts.atoms", val}
        {:process_count, val} -> {"vm.system_counts.procs", val}
        {:port_count, val} -> {"vm.system_counts.ports", val}
      end)

  defp span_attrs([:vm, :total_run_queue_lengths], measurements),
    do: Map.new(measurements, fn {key, val} -> {"vm.run_queue_lengths.#{key}", val} end)
end
