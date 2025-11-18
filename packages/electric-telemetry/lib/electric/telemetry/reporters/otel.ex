defmodule Electric.Telemetry.Reporters.Otel do
  def child_spec(telemetry_opts, reporter_opts) do
    if get_in(telemetry_opts, [:reporters, :otel_metrics?]) do
      otel_opts = Map.get(telemetry_opts, :otel_opts, [])
      start_opts = otel_opts ++ reporter_opts
      {OtelMetricExporter, start_opts}
    end
  end
end
