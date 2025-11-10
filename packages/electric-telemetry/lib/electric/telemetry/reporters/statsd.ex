use Electric.Telemetry

with_telemetry Telemetry.Metrics do
  defmodule Electric.Telemetry.Reporters.Statsd do
    def child_spec(telemetry_opts, reporter_opts) do
      if host = get_in(telemetry_opts, [:reporters, :statsd_host]) do
        start_opts =
          Keyword.merge(
            [
              host: host,
              formatter: :datadog,
              global_tags: [instance_id: telemetry_opts.instance_id]
            ],
            reporter_opts
          )

        {TelemetryMetricsStatsd, start_opts}
      end
    end

    def add_instance_id_tag(metrics) do
      Enum.map(metrics, fn metric -> Map.update!(metric, :tags, &[:instance_id | &1]) end)
    end
  end
end
