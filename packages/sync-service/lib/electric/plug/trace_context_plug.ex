defmodule Electric.Plug.TraceContextPlug do
  @moduledoc """
  A plug that extracts trace context from incoming HTTP headers and sets it as the parent span.
  """

  @behaviour Plug

  def init(opts), do: opts

  def call(%Plug.Conn{req_headers: headers} = conn, _opts) do
    # Extract function expects a list of headers as tuples and knows
    # the expected header keys, so we don't have to prefilter.
    ctx = :otel_propagator_text_map.extract_to(:otel_ctx.new(), headers)

    # Get the span context from the extracted context
    case :otel_tracer.current_span_ctx(ctx) do
      :undefined ->
        # No parent, continue as-is
        conn

      span_ctx ->
        # Parent found, set as current span
        :otel_tracer.set_current_span(span_ctx)
        conn
    end
  end
end
