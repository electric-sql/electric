defmodule Electric.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(opts) do
    children = [
      {:telemetry_poller, measurements: periodic_measurements(opts), period: 2_000}
    ]

    children
    |> add_statsd_reporter(Application.fetch_env!(:electric, :telemetry_statsd_host))
    |> add_prometheus_reporter(Application.fetch_env!(:electric, :prometheus_port))
    |> add_call_home_reporter(Application.fetch_env!(:electric, :call_home_telemetry))
    |> Supervisor.init(strategy: :one_for_one)
  end

  defp add_call_home_reporter(children, false), do: children

  defp add_call_home_reporter(children, true) do
    children ++
      [
        {Electric.Telemetry.CallHomeReporter,
         static_info: static_info(),
         metrics: call_home_metrics(),
         first_report_in: {2, :minute},
         reporting_period: {30, :minute},
         reporter_fn: &Electric.Telemetry.CallHomeReporter.report_home/1}
      ]
  end

  def static_info() do
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
        electric_instance_id: Electric.instance_id()
      }
    }
  end

  def call_home_metrics() do
    [
      environment: [
        pg_version:
          last_value("electric.postgres.info_looked_up.pg_version",
            reporter_options: [persist_between_sends: true]
          )
      ],
      resources: [
        uptime:
          last_value("vm.uptime.total",
            unit: :second,
            measurement: &:erlang.convert_time_unit(&1.total, :native, :second)
          ),
        used_memory: summary("vm.memory.total", unit: :byte),
        run_queue_total: summary("vm.total_run_queue_lengths.total"),
        run_queue_cpu: summary("vm.total_run_queue_lengths.cpu"),
        run_queue_io: summary("vm.total_run_queue_lengths.io")
      ],
      usage: [
        inbound_bytes:
          sum("electric.postgres.replication.transaction_received.bytes", unit: :byte),
        inbound_transactions: sum("electric.postgres.replication.transaction_received.count"),
        inbound_operations: sum("electric.postgres.replication.transaction_received.operations"),
        stored_bytes: sum("electric.storage.transaction_stored.bytes", unit: :byte),
        stored_transactions: sum("electric.storage.transaction_stored.count"),
        stored_operations: sum("electric.storage.transaction_stored.operations"),
        total_used_storage_kb: last_value("electric.storage.used", unit: {:byte, :kilobyte}),
        total_shapes: last_value("electric.shapes.total_shapes.count"),
        active_shapes:
          summary("electric.plug.serve_shape.monotonic_time",
            unit: :unique,
            reporter_options: [count_unique: :shape_handle],
            keep: &(&1.status < 300)
          ),
        unique_clients:
          summary("electric.plug.serve_shape.monotonic_time",
            unit: :unique,
            reporter_options: [count_unique: :client_ip],
            keep: &(&1.status < 300)
          ),
        sync_requests:
          counter("electric.plug.serve_shape.monotonic_time",
            drop: &(Map.get(&1, :live, false) || false)
          ),
        live_requests:
          counter("electric.plug.serve_shape.monotonic_time",
            keep: &(Map.get(&1, :live, false) || false)
          ),
        served_bytes: sum("electric.plug.serve_shape.bytes", unit: :byte),
        wal_size: summary("electric.postgres.replication.wal_size", unit: :byte)
      ]
    ]
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
      summary("electric.shape_cache.create_snapshot_task.stop.duration",
        unit: {:native, :millisecond}
      ),
      summary("electric.storage.make_new_snapshot.stop.duration", unit: {:native, :millisecond}),
      summary("electric.querying.stream_initial_data.stop.duration",
        unit: {:native, :millisecond}
      )
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
      last_value("vm.total_run_queue_lengths.io"),
      last_value("electric.postgres.replication.wal_size", unit: :byte)
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

  defp periodic_measurements(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    [
      # A module, function and arguments to be invoked periodically.
      {__MODULE__, :uptime_event, []},
      {__MODULE__, :count_shapes, [stack_id]},
      {__MODULE__, :get_total_disk_usage, [opts]},
      {Electric.Connection.Manager, :report_retained_wal_size,
       [Electric.Connection.Manager.name(stack_id)]}
    ]
  end

  def uptime_event do
    :telemetry.execute([:vm, :uptime], %{
      total: :erlang.monotonic_time() - :erlang.system_info(:start_time)
    })
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
end
