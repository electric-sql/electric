# This processor reads the SDK-internal `#span{}` record, whose definition lives in the
# `opentelemetry` (SDK) application. That app is only a dependency when building for the
# telemetry target, so the module is only compiled there.
if Electric.telemetry_enabled?() do
  defmodule Electric.Telemetry.OpenTelemetry.EmptyResponseDropProcessor do
    @moduledoc """
    An OTel span processor that tail-drops spans stamped with the `SampleRate = 0`
    sentinel by `Electric.Telemetry.EmptyResponseSampler`.

    `on_end/2` returns `:dropped` for such spans. The SDK stops running the remaining
    processors for a span as soon as one declines it, so registering this processor
    ahead of the exporting processors (see `Electric.Telemetry.OpenTelemetry.Config`)
    keeps a dropped span from ever being queued for export.

    Only empty/up-to-date shape-GET response spans carry `SampleRate = 0`; every other span
    passes through unchanged.
    """

    @behaviour :otel_span_processor

    require Record

    Record.defrecordp(
      :span,
      Record.extract(:span, from_lib: "opentelemetry/include/otel_span.hrl")
    )

    @sample_rate_attr "SampleRate"
    @drop_sample_rate 0

    @impl true
    def on_start(_ctx, span, _config), do: span

    @impl true
    def on_end(span, _config) do
      case sample_rate(span) do
        @drop_sample_rate -> :dropped
        _ -> true
      end
    end

    @impl true
    def force_flush(_config), do: :ok

    defp sample_rate(span) do
      case span(span, :attributes) do
        :undefined -> nil
        attributes -> attributes |> :otel_attributes.map() |> Map.get(@sample_rate_attr)
      end
    end
  end
end
