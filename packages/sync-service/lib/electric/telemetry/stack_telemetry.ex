defmodule Electric.Telemetry.StackTelemetry do
  @moduledoc """
  Collects and exports stack level telemetry such as database and shape metrics.

  If multiple databases are used, each database will have it's own stack and it's own StackTelemetry.

  See also ApplicationTelemetry for application/system level specific telemetry.
  """
  use Supervisor

  import Telemetry.Metrics

  require Logger

  @opts_schema NimbleOptions.new!(
                 Electric.Telemetry.Opts.schema() ++
                   [
                     stack_id: [type: :string, required: true],
                     storage: [type: :mod_arg, required: true]
                   ]
               )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @opts_schema) do
      if telemetry_export_enabled?(Map.new(opts)) do
        Supervisor.start_link(__MODULE__, Map.new(opts))
      else
        # Avoid starting the telemetry supervisor and its telemetry_poller child if we're not
        # intending to export periodic measurements metrics anywhere.
        :ignore
      end
    end
  end

  def init(opts) do
    Process.set_label({:stack_telemetry_supervisor, opts.stack_id})

    [telemetry_poller_child_spec(opts) | exporter_child_specs(opts)]
    |> Supervisor.init(strategy: :one_for_one)
  end

  defp telemetry_poller_child_spec(opts) do
    # The telemetry_poller application starts its own poller by default but we disable that
    # and add its default measurements to the list of our custom ones. This allows for all
    # periodic measurements to be defined in one place.
    {:telemetry_poller,
     measurements: periodic_measurements(opts),
     period: opts.system_metrics_poll_interval,
     init_delay: :timer.seconds(3)}
  end

  defp telemetry_export_enabled?(opts) do
    exporter_child_specs(opts) != []
  end

  defp exporter_child_specs(opts) do
    [
      statsd_reporter_child_spec(opts),
      prometheus_reporter_child_spec(opts),
      call_home_reporter_child_spec(opts),
      otel_reporter_child_spec(opts)
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp otel_reporter_child_spec(%{otel_metrics?: true} = opts) do
    {OtelMetricExporter,
     name: :"stack_otel_telemetry_#{opts.stack_id}",
     metrics: otel_metrics(opts),
     export_period: :timer.seconds(30),
     resource: %{source_id: opts.stack_id}}
  end

  defp otel_reporter_child_spec(_), do: nil

  defp call_home_reporter_child_spec(%{call_home_telemetry?: true} = opts) do
    {Electric.Telemetry.CallHomeReporter,
     name: :"stack_call_home_telemetry_#{opts.stack_id}",
     static_info: static_info(opts),
     metrics: call_home_metrics(opts),
     first_report_in: {2, :minute},
     reporting_period: {30, :minute}}
  end

  defp call_home_reporter_child_spec(_), do: nil

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
        stack_id: opts.stack_id
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

  defp statsd_reporter_child_spec(%{statsd_host: host} = opts) when host != nil do
    {TelemetryMetricsStatsd,
     host: host,
     formatter: :datadog,
     global_tags: [instance_id: opts.instance_id],
     metrics: statsd_metrics(opts)}
  end

  defp statsd_reporter_child_spec(_), do: nil

  defp prometheus_reporter_child_spec(%{prometheus?: true} = opts) do
    {TelemetryMetricsPrometheus.Core,
     name: :"stack_prometheus_telemetry_#{opts.stack_id}", metrics: prometheus_metrics(opts)}
  end

  defp prometheus_reporter_child_spec(_), do: nil

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
      {__MODULE__, :count_shapes, [opts.stack_id]},
      {__MODULE__, :get_total_disk_usage, [opts]},
      {Electric.Connection.Manager, :report_retained_wal_size,
       [Electric.Connection.Manager.name(opts.stack_id)]}
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
    storage = Electric.StackSupervisor.storage_mod_arg(opts)

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

  def for_stack(opts) do
    stack_id = opts.stack_id

    fn metadata ->
      metadata[:stack_id] == stack_id
    end
  end
end
