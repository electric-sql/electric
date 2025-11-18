defmodule Electric.Telemetry.Reporters.Prometheus do
  def child_spec(telemetry_opts, reporter_opts) do
    if get_in(telemetry_opts, [:reporters, :prometheus?]) do
      {TelemetryMetricsPrometheus.Core, add_buckets_to_distribution_metrics(reporter_opts)}
    end
  end

  defp add_buckets_to_distribution_metrics(opts) do
    Keyword.update!(opts, :metrics, fn metrics ->
      Enum.map(metrics, fn
        %Telemetry.Metrics.Distribution{} = metric -> add_buckets_to_metric(metric)
        metric -> metric
      end)
    end)
  end

  @buckets [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1]
  defp add_buckets_to_metric(metric) do
    Map.update!(metric, :reporter_options, &Keyword.put_new(&1, :buckets, @buckets))
  end
end
