defmodule Electric.Telemetry.StackTelemetry do
  @moduledoc """
  Collects and exports stack level telemetry such as database and shape metrics.

  If multiple databases are used, each database will have it's own stack and it's own StackTelemetry.

  See also ApplicationTelemetry for application/system level specific telemetry.
  """
  use Supervisor

  import Telemetry.Metrics

  require Logger

  def start_link(init_arg) do
    if Electric.Config.telemetry_export_enabled?() do
      Supervisor.start_link(__MODULE__, init_arg)
    else
      # Avoid starting the telemetry supervisor and its telemetry_poller child if we're not
      # intending to export periodic measurements metrics anywhere.
      :ignore
    end
  end

  def init(opts) do
    Process.set_label({:stack_telemetry_supervisor, stack_id(opts)})

    system_metrics_poll_interval = Electric.Config.get_env(:system_metrics_poll_interval)
    statsd_host = Electric.Config.get_env(:telemetry_statsd_host)
    prometheus? = not is_nil(Electric.Config.get_env(:prometheus_port))
    call_home_telemetry? = Electric.Config.get_env(:call_home_telemetry?)
    otel_metrics? = not is_nil(Application.get_env(:otel_metric_exporter, :otlp_endpoint))

    [
      {:telemetry_poller,
       measurements: periodic_measurements(opts),
       period: system_metrics_poll_interval,
       init_delay: :timer.seconds(5)},
      statsd_reporter_child_spec(statsd_host, opts),
      prometheus_reporter_child_spec(prometheus?, opts),
      call_home_reporter_child_spec(call_home_telemetry?, opts),
      otel_reporter_child_spec(otel_metrics?, opts)
    ]
    |> Enum.reject(&is_nil/1)
    |> Supervisor.init(strategy: :one_for_one)
  end

  defp otel_reporter_child_spec(true, opts) do
    {OtelMetricExporter, metrics: otel_metrics(opts), export_period: :timer.seconds(30)}
  end

  defp otel_reporter_child_spec(false, _opts), do: nil

  defp call_home_reporter_child_spec(false, _opts), do: nil

  defp call_home_reporter_child_spec(true, opts) do
    {Electric.Telemetry.CallHomeReporter,
     static_info: static_info(opts),
     metrics: call_home_metrics(opts),
     first_report_in: {2, :minute},
     reporting_period: {30, :minute},
     reporter_fn: &Electric.Telemetry.CallHomeReporter.report_home/1}
  end

  def static_info(opts) do
    {total_mem, _, _} = :memsup.get_memory_data()
    processors = :erlang.system_info(:logical_processors)
    {os_family, os_name} = :os.type()
    arch = :erlang.system_info(:system_architecture)

    %{
      electric_version: to_string(Electric.version()),
      environment: %{
        os: %{family: os_family, name: os_name},
        arch: to_string(arch),
        cores: processors,
        ram: total_mem,
        electric_instance_id: Electric.instance_id(),
        stack_id: stack_id(opts)
      }
    }
  end

  # IMPORTANT: these metrics are validated on the receiver side, so if you change them,
  #            make sure you also change the receiver
  def call_home_metrics(opts) do
    for_stack = for_stack(opts)

    [
      environment: [
        pg_version:
          last_value("electric.postgres.info_looked_up.pg_version",
            reporter_options: [persist_between_sends: true],
            keep: for_stack
          )
      ],
      usage: [
        inbound_bytes:
          sum("electric.postgres.replication.transaction_received.bytes",
            unit: :byte,
            keep: for_stack
          ),
        inbound_transactions:
          sum("electric.postgres.replication.transaction_received.count", keep: for_stack),
        inbound_operations:
          sum("electric.postgres.replication.transaction_received.operations", keep: for_stack),
        stored_bytes:
          sum("electric.storage.transaction_stored.bytes", unit: :byte, keep: for_stack),
        stored_transactions: sum("electric.storage.transaction_stored.count", keep: for_stack),
        stored_operations: sum("electric.storage.transaction_stored.operations", keep: for_stack),
        total_used_storage_kb:
          last_value("electric.storage.used", unit: {:byte, :kilobyte}, keep: for_stack),
        total_shapes: last_value("electric.shapes.total_shapes.count", keep: for_stack),
        active_shapes:
          summary("electric.plug.serve_shape.monotonic_time",
            unit: :unique,
            reporter_options: [count_unique: :shape_handle],
            keep: &(&1.status < 300 && for_stack.(&1))
          ),
        unique_clients:
          summary("electric.plug.serve_shape.monotonic_time",
            unit: :unique,
            reporter_options: [count_unique: :client_ip],
            keep: &(&1.status < 300 && for_stack.(&1))
          ),
        sync_requests:
          counter("electric.plug.serve_shape.monotonic_time",
            keep: &(&1[:live] != true && for_stack.(&1))
          ),
        live_requests:
          counter("electric.plug.serve_shape.monotonic_time",
            keep: &(&1[:live] && for_stack.(&1))
          ),
        served_bytes: sum("electric.plug.serve_shape.bytes", unit: :byte, keep: for_stack),
        wal_size: summary("electric.postgres.replication.wal_size", unit: :byte, keep: for_stack)
      ]
    ]
  end

  defp statsd_reporter_child_spec(nil, _opts), do: nil

  defp statsd_reporter_child_spec(host, opts) do
    {TelemetryMetricsStatsd,
     host: host,
     formatter: :datadog,
     global_tags: [instance_id: Electric.instance_id()],
     metrics: statsd_metrics(opts)}
  end

  defp prometheus_reporter_child_spec(false, _opts), do: nil

  defp prometheus_reporter_child_spec(true, opts) do
    {TelemetryMetricsPrometheus.Core, metrics: prometheus_metrics(opts)}
  end

  defp statsd_metrics(opts) do
    [
      summary("plug.router_dispatch.stop.duration",
        tags: [:route],
        unit: {:native, :millisecond},
        keep: for_stack(opts)
      ),
      summary("plug.router_dispatch.exception.duration",
        tags: [:route],
        unit: {:native, :millisecond},
        keep: for_stack(opts)
      ),
      summary("electric.shape_cache.create_snapshot_task.stop.duration",
        unit: {:native, :millisecond},
        keep: for_stack(opts)
      ),
      summary("electric.storage.make_new_snapshot.stop.duration",
        unit: {:native, :millisecond},
        keep: for_stack(opts)
      ),
      summary("electric.querying.stream_initial_data.stop.duration",
        unit: {:native, :millisecond},
        keep: for_stack(opts)
      )
    ]
    |> Enum.map(&%{&1 | tags: [:instance_id | &1.tags]})
  end

  defp prometheus_metrics(opts) do
    [
      last_value("electric.postgres.replication.wal_size", unit: :byte, keep: for_stack(opts)),
      last_value("electric.storage.used", unit: {:byte, :kilobyte}, keep: for_stack(opts)),
      last_value("electric.shapes.total_shapes.count", keep: for_stack(opts)),
      last_value("electric.postgres.replication.wal_size", unit: :byte, keep: for_stack(opts)),
      counter("electric.postgres.replication.transaction_received.count", keep: for_stack(opts)),
      sum("electric.postgres.replication.transaction_received.bytes",
        unit: :byte,
        keep: for_stack(opts)
      ),
      sum("electric.storage.transaction_stored.bytes", unit: :byte, keep: for_stack(opts))
    ]
  end

  defp otel_metrics(opts) do
    for_stack = for_stack(opts)

    [
      distribution("electric.plug.serve_shape.duration",
        keep: &(&1[:live] != true && for_stack.(&1))
      ),
      distribution("electric.shape_cache.create_snapshot_task.stop.duration",
        unit: {:native, :millisecond},
        keep: for_stack
      ),
      distribution("electric.storage.make_new_snapshot.stop.duration",
        unit: {:native, :millisecond},
        keep: for_stack
      )
    ] ++ prometheus_metrics(opts)
  end

  defp periodic_measurements(opts) do
    [
      {__MODULE__, :count_shapes, [stack_id(opts)]},
      {__MODULE__, :get_total_disk_usage, [opts]},
      {Electric.Connection.Manager, :report_retained_wal_size,
       [Electric.Connection.Manager.name(stack_id(opts))]}
    ]
  end

  def count_shapes(stack_id) do
    Electric.ShapeCache.list_shapes(stack_id: stack_id)
    |> length()
    |> then(
      &:telemetry.execute([:electric, :shapes, :total_shapes], %{count: &1}, %{stack_id: stack_id})
    )
  end

  def get_total_disk_usage(opts) do
    storage = Electric.StackSupervisor.storage_mod_arg(Map.new(opts))

    Electric.ShapeCache.Storage.get_total_disk_usage(storage)
    |> then(
      &:telemetry.execute([:electric, :storage], %{used: &1}, %{
        stack_id: opts[:stack_id]
      })
    )
  catch
    :exit, {:noproc, _} ->
      :ok
  end

  defp stack_id(opts) do
    Keyword.fetch!(opts, :stack_id)
  end

  def for_stack(opts) do
    stack_id = stack_id(opts)

    fn metadata ->
      metadata[:stack_id] == stack_id
    end
  end
end
