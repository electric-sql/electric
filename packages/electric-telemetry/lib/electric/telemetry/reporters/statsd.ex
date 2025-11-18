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
          reporter_opts
        )

      {TelemetryMetricsStatsd, start_opts}
    end
  end

  def application_metrics do
    [
      last_value("vm.memory.total", unit: :byte),
      last_value("vm.memory.processes_used", unit: :byte),
      last_value("vm.memory.binary", unit: :byte),
      last_value("vm.memory.ets", unit: :byte),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.total_run_queue_lengths.cpu"),
      last_value("vm.total_run_queue_lengths.io"),
      last_value("system.load_percent.avg1"),
      last_value("system.load_percent.avg5"),
      last_value("system.load_percent.avg15"),
      last_value("system.memory.free_memory"),
      last_value("system.memory.used_memory"),
      last_value("system.swap.free"),
      last_value("system.swap.used")
    ]
    |> add_instance_id_tag()
  end

  def stack_metrics(stack_id) do
    [
      summary("plug.router_dispatch.stop.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("plug.router_dispatch.exception.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("electric.shape_cache.create_snapshot_task.stop.duration",
        unit: {:native, :millisecond}
      ),
      summary("electric.storage.make_new_snapshot.stop.duration",
        unit: {:native, :millisecond}
      ),
      summary("electric.querying.stream_initial_data.stop.duration",
        unit: {:native, :millisecond}
      ),
      last_value("electric.connection.consumers_ready.duration", unit: {:native, :millisecond}),
      last_value("electric.connection.consumers_ready.total"),
      last_value("electric.connection.consumers_ready.before_recovery")
    ]
    |> add_instance_id_tag()
    |> ElectricTelemetry.keep_for_stack(stack_id)
  end

  defp add_instance_id_tag(metrics) do
    Enum.map(metrics, fn metric -> Map.update!(metric, :tags, &[:instance_id | &1]) end)
  end
end
