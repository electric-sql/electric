# The processor reads the SDK-internal `#span{}` record, only available on the telemetry
# target (see the module for details).
if Electric.telemetry_enabled?() do
  defmodule Electric.Telemetry.OpenTelemetry.EmptyResponseDropProcessorTest do
    use ExUnit.Case, async: true

    alias Electric.Telemetry.OpenTelemetry.EmptyResponseDropProcessor, as: Processor

    require Record

    Record.defrecordp(
      :span,
      Record.extract(:span, from_lib: "opentelemetry/include/otel_span.hrl")
    )

    defp span_with_attributes(attrs) do
      span(attributes: :otel_attributes.new(attrs, 128, :infinity))
    end

    describe "on_end/2" do
      test "drops a span stamped with SampleRate = 0" do
        span = span_with_attributes(%{"SampleRate" => 0})
        assert Processor.on_end(span, %{}) == :dropped
      end

      test "keeps a span with a non-zero SampleRate" do
        span = span_with_attributes(%{"SampleRate" => 20})
        assert Processor.on_end(span, %{}) == true
      end

      test "keeps a span with no SampleRate attribute" do
        span = span_with_attributes(%{"other" => "attr"})
        assert Processor.on_end(span, %{}) == true
      end

      test "keeps a span with no attributes at all" do
        assert Processor.on_end(span(), %{}) == true
      end
    end

    test "on_start/3 returns the span unchanged" do
      span = span_with_attributes(%{"SampleRate" => 0})
      assert Processor.on_start(:otel_ctx.new(), span, %{}) == span
    end

    test "force_flush/1 returns :ok" do
      assert Processor.force_flush(%{}) == :ok
    end
  end
end
