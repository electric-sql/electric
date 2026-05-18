defmodule ElectricTelemetry.Reporters.Prometheus do
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

  @latency_buckets [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1]
  @byte_buckets [1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000]

  defp add_buckets_to_metric(%{unit: :byte} = metric) do
    Map.update!(metric, :reporter_options, &Keyword.put_new(&1, :buckets, @byte_buckets))
  end

  defp add_buckets_to_metric(metric) do
    Map.update!(metric, :reporter_options, &Keyword.put_new(&1, :buckets, @latency_buckets))
  end
end
