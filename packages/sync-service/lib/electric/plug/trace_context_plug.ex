defmodule Electric.Plug.TraceContextPlug do
  @moduledoc """
  A plug that extracts trace context from incoming HTTP headers and sets it as the parent span.

  In addition to the standard W3C `traceparent` extraction, this plug parses Electric's
  sample-rate hint from the `tracestate` header. An upstream proxy or gateway that
  head-samples requests at a rate of 1:N tells us about that rate via a tracestate
  member of the form:

      tracestate: electric=rate:<N>

  The hint, together with the remote parent span context and its sampled flag, is stored
  in the conn so that downstream plugs can stamp the `SampleRate` attribute on exported spans,
  letting tracing backends that understand sampling weights scale aggregates by the upstream
  sampling rate (see `sample_rate_attrs/2`);

  Hints that are missing, unparseable or have a rate below 1 are ignored.
  """

  @behaviour Plug

  alias Electric.Telemetry.OpenTelemetry

  @private_key :electric_trace_context
  @tracestate_key "electric"
  @sample_rate_attr "SampleRate"

  @typedoc """
  Remote trace context extracted from the request headers.

    * `:sample_rate_hint` - the upstream 1:N sampling rate parsed from `tracestate`,
      or `nil` when absent/invalid
  """
  @type trace_context :: %{
          sample_rate_hint: pos_integer() | nil
        }

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

        Plug.Conn.put_private(conn, @private_key, %{
          sample_rate_hint: sample_rate_hint(span_ctx)
        })
    end
  end

  @doc """
  The remote trace context extracted from the request headers by this plug, or `nil`
  when the request did not carry a (valid) `traceparent` header.
  """
  @spec trace_context(Plug.Conn.t()) :: trace_context() | nil
  def trace_context(%Plug.Conn{private: private}), do: private[@private_key]

  @doc """
  Span attributes carrying the sampling weight for a response with the given status.

  Tracing backends that support weighted sampling read an integer span attribute named
  `SampleRate` and scale aggregates by it. Successful responses inherit the upstream
  sampling rate from the tracestate hint, while error (>= 500) responses are stamped
  with a rate of 1: they mirror the upstream's keep-all-errors-at-rate-1 semantics.

  Returns an empty map when the request carried no usable rate hint, leaving the spans
  unweighted as before.
  """
  @spec sample_rate_attrs(Plug.Conn.t(), integer() | nil) :: %{
          optional(String.t()) => pos_integer()
        }
  def sample_rate_attrs(conn, status) do
    case trace_context(conn) do
      %{sample_rate_hint: rate} when is_integer(rate) ->
        %{@sample_rate_attr => effective_sample_rate(rate, status)}

      _ ->
        %{}
    end
  end

  defp effective_sample_rate(_rate, status) when is_integer(status) and status >= 500, do: 1
  defp effective_sample_rate(rate, _status), do: rate

  @doc """
  The name of the span attribute that carries the sampling weight.
  """
  @spec sample_rate_attr() :: String.t()
  def sample_rate_attr, do: @sample_rate_attr

  defp sample_rate_hint(span_ctx) do
    with value when is_binary(value) <-
           OpenTelemetry.tracestate_value(span_ctx, @tracestate_key),
         "rate:" <> rate_str <- value,
         {rate, ""} when rate >= 1 <- Integer.parse(rate_str) do
      rate
    else
      _ -> nil
    end
  end
end
