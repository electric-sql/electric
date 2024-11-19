defmodule CloudElectric.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(_) do
    children = [
      {:telemetry_poller, measurements: [], period: 2_000}
    ]

    children
    |> add_prometheus_reporter(Application.fetch_env!(:electric, :prometheus_port))
    |> Supervisor.init(strategy: :one_for_one)
  end

  defp add_prometheus_reporter(children, nil), do: children

  defp add_prometheus_reporter(children, _) do
    children ++ [{TelemetryMetricsPrometheus.Core, metrics: prometheus_metrics()}]
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
    ]
  end
end
