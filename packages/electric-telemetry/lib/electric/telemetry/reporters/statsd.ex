defmodule ElectricTelemetry.Reporters.Statsd do
  import Telemetry.Metrics

  def child_spec(telemetry_opts, reporter_opts) do
    if host = get_in(telemetry_opts, [:reporters, :statsd_host]) do
      start_opts =
        Keyword.merge(
          [
            host: host,
            formatter: :datadog,
            global_tags: [instance_id: telemetry_opts.instance_id]
          ],
          Keyword.update!(reporter_opts, :metrics, &add_instance_id_tag/1)
        )

      {TelemetryMetricsStatsd, start_opts}
    end
  end

  defp add_instance_id_tag(metrics) do
    Enum.map(metrics, fn metric -> Map.update!(metric, :tags, &[:instance_id | &1]) end)
  end

  def router_dispatch_metrics do
    [
      distribution("plug.router_dispatch.stop.duration",
        tags: [:route, :status],
        unit: {:native, :millisecond}
      ),
      distribution("plug.router_dispatch.exception.duration",
        tags: [:route, :status],
        unit: {:native, :millisecond}
      )
    ]
  end
end
