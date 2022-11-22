defmodule Electric.Telemetry do
  use Supervisor
  alias Telemetry.Metrics

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(_) do
    children = [
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
    ]
end
