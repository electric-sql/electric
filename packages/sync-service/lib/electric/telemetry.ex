defmodule Electric.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(_) do
    children = [
      {:telemetry_poller, measurements: periodic_measurements(), period: 2_000}
    ]

    children
    |> add_statsd_reporter(Application.fetch_env!(:electric, :telemetry_statsd_host))
    |> add_prometheus_reporter(Application.fetch_env!(:electric, :prometheus_port))
    |> Supervisor.init(strategy: :one_for_one)
  end

  defp add_statsd_reporter(children, nil), do: children

  defp add_statsd_reporter(children, host) do
    children ++
      [
        {TelemetryMetricsStatsd,
         host: host,
         formatter: :datadog,
         global_tags: [instance_id: Electric.instance_id()],
         metrics: statsd_metrics()}
      ]
  end

  defp add_prometheus_reporter(children, nil), do: children

  defp add_prometheus_reporter(children, _) do
    children ++ [{TelemetryMetricsPrometheus.Core, metrics: prometheus_metrics()}]
  end

  defp statsd_metrics() do
    [
      last_value("vm.memory.total", unit: :byte),
      last_value("vm.memory.processes_used", unit: :byte),
      last_value("vm.memory.binary", unit: :byte),
      last_value("vm.memory.ets", unit: :byte),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.total_run_queue_lengths.cpu"),
      last_value("vm.total_run_queue_lengths.io"),
      summary("plug.router_dispatch.stop.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("plug.router_dispatch.exception.duration",
        tags: [:route],
        unit: {:native, :millisecond}
      ),
      summary("electric.shape_cache.create_snapshot_task.stop", unit: {:native, :millisecond})
    ]
    |> Enum.map(&%{&1 | tags: [:instance_id | &1.tags]})
  end

  defp prometheus_metrics() do
    [
      last_value("vm.memory.total", unit: :byte),
      last_value("vm.memory.processes_used", unit: :byte),
      last_value("vm.memory.binary", unit: :byte),
      last_value("vm.memory.ets", unit: :byte),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.total_run_queue_lengths.cpu"),
      last_value("vm.total_run_queue_lengths.io")
      # distribution("plug.router_dispatch.stop.duration",
      #   tags: [:route],
      #   unit: {:native, :millisecond}
      # ),
      # distribution("plug.router_dispatch.exception.duration",
      #   tags: [:route],
      #   unit: {:native, :millisecond}
      # ),
      # distribution("electric.query.duration", unit: {:native, :millisecond}),
      # distribution("electric.query.serialization_duration", unit: {:native, :millisecond}),
      # distribution("electric.snapshot.storage", unit: {:native, :millisecond}),
      # distribution("electric.snapshot.encoding", unit: {:native, :millisecond})
    ]
  end

  defp periodic_measurements do
    [
      # A module, function and arguments to be invoked periodically.
      {__MODULE__, :uptime_event, []}
    ]
  end

  def uptime_event do
    :telemetry.execute([:vm, :uptime], %{
      total: :erlang.monotonic_time() - :erlang.system_info(:start_time)
    })
  end
end
