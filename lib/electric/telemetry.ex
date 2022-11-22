defmodule Electric.Telemetry do
  use Supervisor
  alias Telemetry.Metrics

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(_) do
    children = [
      {:telemetry_poller, measurements: periodic_measurements(), period: 2_000},
      {TelemetryMetricsPrometheus, [metrics: metrics()]}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp metrics(),
    do: [
      Metrics.counter("electric.postgres_tcp_server.connection.total"),
      Metrics.counter("electric.postgres_slot.replication.start"),
      Metrics.counter("electric.postgres_slot.replication.stop"),
      Metrics.sum("electric.postgres_slot.replication.sent_count"),
      Metrics.counter("electric.postgres_logical.received.total"),
      Metrics.counter("electric.vaxine_consumer.replication.saved"),
      Metrics.counter("electric.vaxine_consumer.replication.failed_to_write"),
      Metrics.counter("electric.satellite.connection.authorized_connection"),
      Metrics.counter("electric.satellite.connection.authorized_connection"),
      Metrics.counter("electric.satellite.replication.started"),
      Metrics.counter("electric.satellite.replication.stopped"),
      Metrics.last_value("vm.memory.total", unit: :byte),
      Metrics.last_value("vm.total_run_queue_lengths.total"),
      Metrics.last_value("vm.total_run_queue_lengths.cpu"),
      Metrics.last_value("vm.total_run_queue_lengths.io"),
      Metrics.last_value("vm.system_counts.process_count"),
      Metrics.last_value("vm.system_counts.atom_count"),
      Metrics.last_value("vm.system_counts.port_count")
    ]

  defp periodic_measurements do
    [
      # A module, function and arguments to be invoked periodically.
      # This function must call :telemetry.execute/3 and a metric must be added above.
      # {TestAuthAppWeb, :count_users, []}
    ]
  end
end
