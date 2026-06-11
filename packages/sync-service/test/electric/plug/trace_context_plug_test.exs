# The W3C trace context propagator is configured by the :opentelemetry SDK application,
# which is only a dependency when building for the telemetry target (MIX_TARGET=application,
# the configuration CI runs the test suite with).
if Electric.telemetry_enabled?() do
  defmodule Electric.Plug.TraceContextPlugTest do
    use ExUnit.Case, async: true

    alias Electric.Plug.TraceContextPlug

    @trace_id_hex "0af7651916cd43dd8448eb211c80319c"
    @parent_span_id_hex "b7ad6b7169203331"

    defp call(headers) do
      headers
      |> Enum.reduce(Plug.Test.conn(:get, "/v1/shape"), fn {key, value}, conn ->
        Plug.Conn.put_req_header(conn, key, value)
      end)
      |> TraceContextPlug.call([])
    end

    defp traceparent(flags), do: "00-#{@trace_id_hex}-#{@parent_span_id_hex}-#{flags}"

    test "no traceparent: conn passes through with no trace context" do
      conn = call([])
      assert TraceContextPlug.trace_context(conn) == nil
    end

    test "tracestate without traceparent is ignored" do
      conn = call([{"tracestate", "electric=rate:20"}])
      assert TraceContextPlug.trace_context(conn) == nil
    end

    test "sampled traceparent with rate hint" do
      conn = call([{"traceparent", traceparent("01")}, {"tracestate", "electric=rate:20"}])

      assert %{parent_sampled?: true, sample_rate_hint: 20, parent_span_ctx: span_ctx} =
               TraceContextPlug.trace_context(conn)

      assert span_ctx != :undefined
      # The extracted remote parent is installed as the current span for this process.
      assert :otel_tracer.current_span_ctx() == span_ctx
    end

    test "unsampled traceparent still parses the rate hint" do
      conn = call([{"traceparent", traceparent("00")}, {"tracestate", "electric=rate:20"}])

      assert %{parent_sampled?: false, sample_rate_hint: 20} =
               TraceContextPlug.trace_context(conn)
    end

    test "traceparent without tracestate: no rate hint" do
      conn = call([{"traceparent", traceparent("01")}])

      assert %{parent_sampled?: true, sample_rate_hint: nil} =
               TraceContextPlug.trace_context(conn)
    end

    test "electric member is found among other tracestate members" do
      conn =
        call([
          {"traceparent", traceparent("01")},
          {"tracestate", "congo=t61rcWkgMzE,electric=rate:42,rojo=00f067aa0ba902b7"}
        ])

      assert %{sample_rate_hint: 42} = TraceContextPlug.trace_context(conn)
    end

    test "whitespace around tracestate members is tolerated" do
      conn =
        call([
          {"traceparent", traceparent("01")},
          {"tracestate", "congo=t61rcWkgMzE , electric=rate:7"}
        ])

      assert %{sample_rate_hint: 7} = TraceContextPlug.trace_context(conn)
    end

    test "rate of exactly 1 is accepted" do
      conn = call([{"traceparent", traceparent("01")}, {"tracestate", "electric=rate:1"}])
      assert %{sample_rate_hint: 1} = TraceContextPlug.trace_context(conn)
    end

    for tracestate <- [
          # rate < 1
          "electric=rate:0",
          "electric=rate:-5",
          # non-integer / trailing garbage
          "electric=rate:1.5",
          "electric=rate:20x",
          "electric=rate:abc",
          "electric=rate:",
          # wrong member format
          "electric=ratio:20",
          "electric=20",
          # no electric member at all
          "congo=t61rcWkgMzE",
          "notelectric=rate:20"
        ] do
      test "invalid or missing hint in #{inspect(tracestate)} is ignored" do
        conn =
          call([{"traceparent", traceparent("01")}, {"tracestate", unquote(tracestate)}])

        assert %{parent_sampled?: true, sample_rate_hint: nil} =
                 TraceContextPlug.trace_context(conn)
      end
    end

    describe "sample_rate_attrs/2" do
      test "uses the hinted rate for non-5xx statuses" do
        conn = call([{"traceparent", traceparent("01")}, {"tracestate", "electric=rate:20"}])

        assert TraceContextPlug.sample_rate_attrs(conn, 200) == %{"SampleRate" => 20}
        assert TraceContextPlug.sample_rate_attrs(conn, 304) == %{"SampleRate" => 20}
        assert TraceContextPlug.sample_rate_attrs(conn, 404) == %{"SampleRate" => 20}
        assert TraceContextPlug.sample_rate_attrs(conn, 499) == %{"SampleRate" => 20}
        # Status not yet known: default to the success-path rate.
        assert TraceContextPlug.sample_rate_attrs(conn, nil) == %{"SampleRate" => 20}
      end

      test "5xx statuses override the hint with rate 1" do
        conn = call([{"traceparent", traceparent("01")}, {"tracestate", "electric=rate:20"}])

        assert TraceContextPlug.sample_rate_attrs(conn, 500) == %{"SampleRate" => 1}
        assert TraceContextPlug.sample_rate_attrs(conn, 503) == %{"SampleRate" => 1}
      end

      test "returns no attributes without a rate hint" do
        conn = call([{"traceparent", traceparent("01")}])
        assert TraceContextPlug.sample_rate_attrs(conn, 200) == %{}
        assert TraceContextPlug.sample_rate_attrs(conn, 500) == %{}
      end

      test "returns no attributes without a remote parent" do
        conn = call([])
        assert TraceContextPlug.sample_rate_attrs(conn, 500) == %{}
      end
    end
  end
end
