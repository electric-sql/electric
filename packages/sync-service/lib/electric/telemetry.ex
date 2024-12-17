defmodule Electric.Telemetry do
  use Supervisor

  import Telemetry.Metrics

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(opts) do
    system_metrics_poll_interval = Application.get_env(:electric, :system_metrics_poll_interval)

    statsd_host = Application.fetch_env!(:electric, :telemetry_statsd_host)
    prometheus? = not is_nil(Application.fetch_env!(:electric, :prometheus_port))
    call_home_telemetry? = Application.fetch_env!(:electric, :call_home_telemetry?)

    [
      {:telemetry_poller,
       measurements: periodic_measurements(opts),
       period: system_metrics_poll_interval,
       init_delay: :timer.seconds(5)},
      statsd_reporter_child_spec(statsd_host),
      prometheus_reporter_child_spec(prometheus?),
      call_home_reporter_child_spec(call_home_telemetry?)
    ]
    |> Enum.reject(&is_nil/1)
    |> Supervisor.init(strategy: :one_for_one)
  end

  defp call_home_reporter_child_spec(false), do: nil

  defp call_home_reporter_child_spec(true) do
    {Electric.Telemetry.CallHomeReporter,
     static_info: static_info(),
     metrics: call_home_metrics(),
     first_report_in: {2, :minute},
     reporting_period: {30, :minute},
     reporter_fn: &Electric.Telemetry.CallHomeReporter.report_home/1}
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
      system: [
        load_avg1: last_value("system.load_percent.avg1"),
        load_avg5: last_value("system.load_percent.avg5"),
        load_avg15: last_value("system.load_percent.avg15"),
        memory_free: last_value("system.memory.free_memory"),
        memory_used: last_value("system.memory.used_memory"),
        memory_free_percent: last_value("system.memory_percent.free_memory"),
        memory_used_percent: last_value("system.memory_percent.used_memory"),
        swap_free: last_value("system.swap.free"),
        swap_used: last_value("system.swap.used"),
        swap_free_percent: last_value("system.swap_percent.free"),
        swap_used_percent: last_value("system.swap_percent.used")
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

  defp statsd_reporter_child_spec(nil), do: nil

  defp statsd_reporter_child_spec(host) do
    {TelemetryMetricsStatsd,
     host: host,
     formatter: :datadog,
     global_tags: [instance_id: Electric.instance_id()],
     metrics: statsd_metrics()}
  end

  defp prometheus_reporter_child_spec(false), do: nil

  defp prometheus_reporter_child_spec(true) do
    {TelemetryMetricsPrometheus.Core, metrics: prometheus_metrics()}
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
      ),
      last_value("system.load_percent.avg1"),
      last_value("system.load_percent.avg5"),
      last_value("system.load_percent.avg15"),
      last_value("system.memory.free_memory"),
      last_value("system.memory.used_memory"),
      last_value("system.swap.free"),
      last_value("system.swap.used")
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
      last_value("vm.system_counts.process_count"),
      last_value("vm.system_counts.atom_count"),
      last_value("vm.system_counts.port_count"),
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
      :memory,
      :total_run_queue_lengths,
      :system_counts,
      {__MODULE__, :uptime_event, []},
      {__MODULE__, :count_shapes, [stack_id]},
      {__MODULE__, :get_total_disk_usage, [opts]},
      {__MODULE__, :get_system_load_average, [opts]},
      {__MODULE__, :get_system_memory_usage, [opts]},
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

  def get_system_load_average(opts) do
    cores = :erlang.system_info(:logical_processors)

    # > The load values are proportional to how long time a runnable Unix
    # > process has to spend in the run queue before it is scheduled.
    # > Accordingly, higher values mean more system load. The returned value
    # > divided by 256 produces the figure displayed by rup and top.
    #
    # I'm going one step further and dividing by the number of CPUs so in a 4
    # core system, a load of 4.0 (in top) will show as 100%.
    # Since load can go above num cores, we can to 200%, 300% but
    # I think this makes sense.
    #
    # Certainly the formula in the erlang docs:
    #
    # > the following simple mathematical transformation can produce the load
    # > value as a percentage:
    # >
    # >   PercentLoad = 100 * (1 - D/(D + Load))
    # >
    # > D determines which load value should be associated with which
    # > percentage. Choosing D = 50 means that 128 is 60% load, 256 is 80%, 512
    # > is 90%, and so on.
    #
    # Makes little sense. Setting `D` as they say and plugging in a avg1 value
    # of 128 does not give 60% so I'm not sure how to square what they say with
    # the numbers...
    #
    # e.g. my machine currently has a cpu util (:cpu_sup.util()) of 4% and an
    # avg1() of 550 ish across 24 cores (so doing very little) but that formula
    # would give a `PercentLoad` of ~92%.
    #
    # My version would give value of 550 / 256 / 24 = 9%
    [:avg1, :avg5, :avg15]
    |> Map.new(fn probe ->
      {probe, 100 * (apply(:cpu_sup, probe, []) / 256 / cores)}
    end)
    |> then(
      &:telemetry.execute([:system, :load_percent], &1, %{
        stack_id: opts[:stack_id]
      })
    )
  end

  def get_system_memory_usage(opts) do
    {total, stats} =
      :memsup.get_system_memory_data()
      |> Keyword.delete(:total_memory)
      |> Keyword.pop(:system_total_memory)

    mem_stats =
      Keyword.take(stats, [:free_memory, :available_memory, :buffered_memory, :cached_memory])

    {total_swap, stats} = Keyword.pop(stats, :total_swap)

    used_memory = total - Keyword.fetch!(mem_stats, :free_memory)
    resident_memory = total - Keyword.fetch!(mem_stats, :available_memory)

    memory_stats =
      mem_stats
      |> Map.new()
      |> Map.put(:used_memory, used_memory)
      |> Map.put(:resident_memory, resident_memory)

    memory_percent_stats =
      mem_stats
      |> Map.new(fn {k, v} -> {k, 100 * v / total} end)
      |> Map.put(:used_memory, 100 * used_memory / total)
      |> Map.put(:resident_memory, 100 * resident_memory / total)

    :telemetry.execute([:system, :memory], memory_stats, %{
      stack_id: opts[:stack_id]
    })

    :telemetry.execute([:system, :memory_percent], memory_percent_stats, %{
      stack_id: opts[:stack_id]
    })

    free_swap = Keyword.get(stats, :free_swap, 0)
    used_swap = total_swap - free_swap

    swap_stats = %{total: total_swap, free: free_swap, used: used_swap}
    swap_percent_stats = %{free: 100 * free_swap / total_swap, used: 100 * used_swap / total_swap}

    :telemetry.execute([:system, :swap], swap_stats, %{stack_id: opts[:stack_id]})
    :telemetry.execute([:system, :swap_percent], swap_percent_stats, %{stack_id: opts[:stack_id]})
  end
end
