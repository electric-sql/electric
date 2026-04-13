defmodule Electric.LiveDashboardMetrics do
  @moduledoc """
  Telemetry metrics for Phoenix LiveDashboard.
  """

  import Telemetry.Metrics

  def metrics do
    [
      # VM Metrics
      last_value("vm.memory.total", unit: {:byte, :megabyte}),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.total_run_queue_lengths.cpu"),
      last_value("vm.total_run_queue_lengths.io"),

      # HTTP Metrics
      summary("electric.routing.stop.duration",
        unit: {:native, :millisecond},
        tags: [:method, :path_info]
      ),
      counter("electric.routing.stop.count",
        tags: [:method, :status]
      )
    ]
  end
end
