defmodule Electric.Telemetry.StackTelemetry do
  @moduledoc """
  Collects and exports stack level telemetry such as database and shape metrics.

  If multiple databases are used, each database will have it's own stack and it's own StackTelemetry.

  See also ApplicationTelemetry for application/system level specific telemetry.
  """
  use Supervisor

  import Telemetry.Metrics

  alias Electric.Telemetry.Reporters

  require Logger

  @behaviour Electric.Telemetry.Poller

  def start_link(opts) do
    with {:ok, opts} <- ElectricTelemetry.validate_options(opts) do
      if ElectricTelemetry.export_enabled?(opts) do
        Supervisor.start_link(__MODULE__, opts)
      else
        # Avoid starting the telemetry supervisor and its telemetry_poller child if we're not
        # intending to export periodic measurements metrics anywhere.
        :ignore
      end
    end
  end

  @impl Supervisor
  def init(%{stack_id: stack_id} = opts) do
    Process.set_label({:stack_telemetry_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)

    children =
      [
        Electric.Telemetry.Poller.child_spec(opts,
          callback_module: __MODULE__,
          init_delay: :timer.seconds(3)
        )
        | exporter_child_specs(opts)
      ]
      |> Enum.reject(&is_nil/1)

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp exporter_child_specs(%{stack_id: stack_id} = opts) do
    metrics = metrics(opts)

    [
      Reporters.CallHomeReporter.child_spec(
        opts,
        stack_id: stack_id,
        name: :"stack_call_home_telemetry_#{stack_id}",
        metrics: Reporters.CallHomeReporter.stack_metrics(stack_id)
      ),
      Reporters.Otel.child_spec(opts,
        name: :"stack_otel_telemetry_#{stack_id}",
        metrics: metrics
      ),
      Reporters.Prometheus.child_spec(opts,
        name: :"stack_prometheus_telemetry_#{stack_id}",
        metrics: metrics
      ),
      Reporters.Statsd.child_spec(opts, metrics: statsd_metrics(opts.stack_id))
    ]
  end

  @impl Electric.Telemetry.Poller
  def builtin_periodic_measurements(_), do: []

  def metrics(telemetry_opts) do
    [
      distribution("electric.plug.serve_shape.duration",
        unit: {:native, :millisecond},
        keep: fn metadata -> metadata[:live] != true end
      ),
      distribution("electric.shape_cache.create_snapshot_task.stop.duration",
        unit: {:native, :millisecond}
      ),
      distribution("electric.storage.make_new_snapshot.stop.duration",
        unit: {:native, :millisecond}
      ),
      distribution("electric.postgres.replication.transaction_received.receive_lag",
        unit: :millisecond
      ),
      distribution("electric.postgres.replication.transaction_received.operations"),
      distribution("electric.storage.transaction_stored.replication_lag", unit: :millisecond),
      last_value("electric.postgres.replication.wal_size", unit: :byte),
      last_value("electric.storage.used", unit: {:byte, :kilobyte}),
      last_value("electric.shapes.total_shapes.count"),
      last_value("electric.shapes.active_shapes.count"),
      counter("electric.postgres.replication.transaction_received.count"),
      sum("electric.postgres.replication.transaction_received.bytes", unit: :byte),
      sum("electric.storage.transaction_stored.bytes", unit: :byte),
      last_value("electric.shape_monitor.active_reader_count"),
      last_value("electric.connection.consumers_ready.duration",
        unit: {:native, :millisecond}
      ),
      last_value("electric.connection.consumers_ready.total"),
      last_value("electric.connection.consumers_ready.failed_to_recover"),
      last_value("electric.admission_control.acquire.current"),
      sum("electric.admission_control.reject.count")
      | additional_metrics(telemetry_opts)
    ]
    |> keep_for_stack(telemetry_opts.stack_id)
  end

  def additional_metrics(%{additional_metrics: metrics}), do: metrics
  def additional_metrics(_), do: []

  def statsd_metrics(stack_id) do
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
    |> Electric.Telemetry.Reporters.Statsd.add_instance_id_tag()
    |> keep_for_stack(stack_id)
  end

  defp keep_for_stack(metrics, stack_id) do
    Enum.map(metrics, fn metric ->
      Map.update!(metric, :keep, fn
        nil -> fn metadata -> metadata[:stack_id] == stack_id end
        fun -> fn metadata -> fun.(metadata) && metadata[:stack_id] == stack_id end
      end)
    end)
  end
end
