defmodule Electric.Plug.TraceContextPlug do
  @moduledoc """
  A plug that extracts trace context from incoming HTTP headers and sets it as the parent span.
  """
  @behaviour Plug

  require Logger

  def init(opts), do: opts

  def call(conn, _opts) do
    case extract_trace_context(conn) do
      {:ok, span_ctx} ->
        Logger.info("TraceContextPlug: Successfully extracted trace context")
        :otel_tracer.set_current_span(span_ctx)
        conn
      :error ->
        Logger.info("TraceContextPlug: No trace context found")
        conn
    end
  end

  # Extract trace context using the OpenTelemetry propagator
  defp extract_trace_context(conn) do
    # Get all headers as a list of {key, value} tuples
    headers = conn
      |> Plug.Conn.get_req_header("traceparent")
      |> Enum.map(fn value -> {"traceparent", value} end)

    Logger.info("TraceContextPlug: Extracting from headers: #{inspect(headers)}")

    # Create a new context and extract the trace context from headers
    ctx = :otel_propagator_trace_context.extract(
      :otel_ctx.new(),
      headers,
      :undefined,
      &header_getter/2,
      %{}
    )
    
    # Get the span context from the extracted context
    case :otel_tracer.current_span_ctx(ctx) do
      :undefined ->
        Logger.info("TraceContextPlug: No span context found")
        :error
      span_ctx ->
        Logger.info("TraceContextPlug: Found span context: #{inspect(span_ctx)}")
        {:ok, span_ctx}
    end
  end

  # Header getter function for the propagator
  # Note: The key is passed first, carrier second by the propagator
  defp header_getter(key, carrier) when is_list(carrier) do
    Logger.debug("TraceContextPlug: Looking for header #{key} in #{inspect(carrier)}")
    case Enum.find(carrier, fn {k, _v} -> String.downcase(k) == String.downcase(key) end) do
      {_key, value} -> value
      nil -> []
    end
  end
  # Fallback clause for when carrier is not a list
  defp header_getter(key, carrier) do
    Logger.debug("TraceContextPlug: Invalid carrier type for key #{key}: #{inspect(carrier)}")
    []
  end
end
