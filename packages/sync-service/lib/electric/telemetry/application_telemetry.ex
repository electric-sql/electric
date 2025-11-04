use Electric.Telemetry

with_telemetry [Telemetry.Metrics, OtelMetricExporter] do
  defmodule Electric.Telemetry.ApplicationTelemetry do
    @moduledoc """
    Collects and exports application level telemetry such as CPU, memory and BEAM metrics.

    See also StackTelemetry for stack specific telemetry.
    """
    use Supervisor

    import Telemetry.Metrics

    require Logger

    @opts_schema NimbleOptions.new!(Electric.Telemetry.Opts.schema())

    def start_link(opts) do
      with {:ok, opts} <- NimbleOptions.validate(opts, @opts_schema) do
        if telemetry_export_enabled?(Map.new(opts)) do
          Supervisor.start_link(__MODULE__, Map.new(opts), name: __MODULE__)
        else
          # Avoid starting the telemetry supervisor and its telemetry_poller child if we're not
          # intending to export periodic measurements metrics anywhere.
          :ignore
        end
      end
    end

    def init(opts) do
      Process.set_label(:application_telemetry_supervisor)

      [
        system_monitor_child_spec(opts),
        telemetry_poller_child_spec(opts) | exporter_child_specs(opts)
      ]
      |> Supervisor.init(strategy: :one_for_one)
    end

    defp system_monitor_child_spec(opts) do
      {Electric.Telemetry.SystemMonitor, opts}
    end

    defp telemetry_poller_child_spec(opts) do
      {:telemetry_poller,
       measurements: periodic_measurements(opts),
       period: opts.system_metrics_poll_interval,
       init_delay: :timer.seconds(5)}
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
      {OtelMetricExporter, metrics: otel_metrics(opts), export_period: opts.otel_export_period}
    end

    defp otel_reporter_child_spec(_), do: nil

    defp call_home_reporter_child_spec(%{call_home_telemetry?: true} = opts) do
      {Electric.Telemetry.CallHomeReporter,
       static_info: static_info(opts),
       metrics: call_home_metrics(),
       first_report_in: {2, :minute},
       reporting_period: {30, :minute}}
    end

    defp call_home_reporter_child_spec(_), do: nil

    defp static_info(opts) do
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
          electric_instance_id: Map.fetch!(opts, :instance_id),
          electric_installation_id: Map.get(opts, :installation_id, "electric_default")
        }
      }
    end

    # IMPORTANT: these metrics are validated on the receiver side, so if you change them,
    #            make sure you also change the receiver
    def call_home_metrics() do
      [
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
        ]
      ]
    end

    defp statsd_reporter_child_spec(%{statsd_host: host} = opts) when host != nil do
      {TelemetryMetricsStatsd,
       host: host,
       formatter: :datadog,
       global_tags: [instance_id: opts.instance_id],
       metrics: statsd_metrics()}
    end

    defp statsd_reporter_child_spec(_), do: nil

    defp prometheus_reporter_child_spec(%{prometheus?: true}) do
      {TelemetryMetricsPrometheus.Core, metrics: prometheus_metrics()}
    end

    defp prometheus_reporter_child_spec(_), do: nil

    defp statsd_metrics() do
      [
        last_value("vm.memory.total", unit: :byte),
        last_value("vm.memory.processes_used", unit: :byte),
        last_value("vm.memory.binary", unit: :byte),
        last_value("vm.memory.ets", unit: :byte),
        last_value("vm.total_run_queue_lengths.total"),
        last_value("vm.total_run_queue_lengths.cpu"),
        last_value("vm.total_run_queue_lengths.io"),
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

    defp prometheus_metrics do
      num_schedulers = :erlang.system_info(:schedulers)
      schedulers_range = 1..num_schedulers

      num_dirty_cpu_schedulers = :erlang.system_info(:dirty_cpu_schedulers)

      dirty_cpu_schedulers_range =
        (num_schedulers + 1)..(num_schedulers + num_dirty_cpu_schedulers)

      [
        last_value("process.memory.total", tags: [:process_type], unit: :byte),
        last_value("system.cpu.core_count"),
        last_value("system.cpu.utilization.total"),
        last_value("vm.garbage_collection.total_runs"),
        last_value("vm.garbage_collection.total_bytes_reclaimed", unit: :byte),
        last_value("vm.memory.atom", unit: :byte),
        last_value("vm.memory.atom_used", unit: :byte),
        last_value("vm.memory.binary", unit: :byte),
        last_value("vm.memory.code", unit: :byte),
        last_value("vm.memory.ets", unit: :byte),
        last_value("vm.memory.processes", unit: :byte),
        last_value("vm.memory.processes_used", unit: :byte),
        last_value("vm.memory.system", unit: :byte),
        last_value("vm.memory.total", unit: :byte),
        last_value("vm.reductions.total"),
        last_value("vm.reductions.delta"),
        last_value("vm.run_queue_lengths.total"),
        last_value("vm.run_queue_lengths.total_plus_io"),
        last_value("vm.scheduler_utilization.total"),
        last_value("vm.scheduler_utilization.weighted"),
        last_value("vm.system_counts.atom_count"),
        last_value("vm.system_counts.port_count"),
        last_value("vm.system_counts.process_count"),
        last_value("vm.total_run_queue_lengths.total"),
        last_value("vm.total_run_queue_lengths.cpu"),
        last_value("vm.total_run_queue_lengths.io"),
        last_value("vm.uptime.total",
          unit: :second,
          measurement: &:erlang.convert_time_unit(&1.total, :native, :second)
        )
      ] ++
        Enum.map(
          # Add "system.cpu.utilization.core_*" but since there's no wildcard support we
          # explicitly add the cores here.
          0..(:erlang.system_info(:logical_processors) - 1),
          &last_value("system.cpu.utilization.core_#{&1}")
        ) ++
        Enum.map(scheduler_ids(), &last_value("vm.run_queue_lengths.#{&1}")) ++
        Enum.map(schedulers_range, &last_value("vm.scheduler_utilization.normal_#{&1}")) ++
        Enum.map(dirty_cpu_schedulers_range, &last_value("vm.scheduler_utilization.cpu_#{&1}"))
    end

    defp otel_metrics(opts) do
      [
        last_value("system.load_percent.avg1"),
        last_value("system.load_percent.avg5"),
        last_value("system.load_percent.avg15"),
        last_value("system.memory_percent.free_memory"),
        last_value("system.memory_percent.available_memory"),
        last_value("system.memory_percent.used_memory"),
        sum("vm.monitor.long_message_queue.length", tags: [:process_type]),
        distribution("vm.monitor.long_schedule.timeout",
          tags: [:process_type],
          unit: :millisecond
        ),
        distribution("vm.monitor.long_gc.timeout", tags: [:process_type], unit: :millisecond)
      ] ++
        prometheus_metrics() ++
        memory_by_process_type_metrics(opts)
    end

    defp memory_by_process_type_metrics(%{otel_per_process_metrics?: true}) do
      [
        last_value("process.memory.total", tags: [:process_type], unit: :byte)
      ]
    end

    defp memory_by_process_type_metrics(_), do: []

    defp scheduler_ids do
      num_schedulers = :erlang.system_info(:schedulers)
      Enum.map(1..num_schedulers, &:"normal_#{&1}") ++ [:cpu, :io]
    end

    defp periodic_measurements(opts) do
      word_size = :erlang.system_info(:wordsize)

      [
        # Measurements included with the telemetry_poller application.
        #
        # By default, The telemetry_poller application starts its own poller but we disable that
        # and add its default measurements to the list of our custom ones.
        #
        # This allows for all periodic measurements to be defined in one place.
        :memory,
        :total_run_queue_lengths,
        :system_counts,

        # Our custom measurements:
        {__MODULE__, :uptime_event, []},
        {__MODULE__, :cpu_utilization, []},
        {__MODULE__, :scheduler_utilization, []},
        {__MODULE__, :run_queue_lengths, [scheduler_ids()]},
        {__MODULE__, :garbage_collection, [word_size]},
        {__MODULE__, :reductions, []},
        {__MODULE__, :process_memory, [opts]},
        {__MODULE__, :get_system_load_average, []},
        {__MODULE__, :get_system_memory_usage, []}
      ]
    end

    def uptime_event do
      :telemetry.execute([:vm, :uptime], %{
        total: :erlang.monotonic_time() - :erlang.system_info(:start_time)
      })
    end

    def process_memory(%{top_process_count: process_count}) do
      for %{type: type, memory: memory} <-
            Electric.Telemetry.Processes.top_memory_by_type(process_count) do
        :telemetry.execute([:process, :memory], %{total: memory}, %{process_type: to_string(type)})
      end
    end

    def cpu_utilization do
      case :cpu_sup.util([:per_cpu]) do
        {:error, reason} ->
          Logger.debug("Failed to collect CPU utilization: #{inspect(reason)}")

        data ->
          {per_core_utilization, bare_values} =
            for {cpu_index, busy, _free, _misc} <- data do
              {{:"core_#{cpu_index}", busy}, busy}
            end
            |> Enum.unzip()

          utilization =
            per_core_utilization
            |> Map.new()
            |> Map.put(:total, mean(bare_values))

          :telemetry.execute([:system, :cpu, :utilization], utilization)

          :telemetry.execute([:system, :cpu], %{core_count: length(bare_values)})
      end
    end

    # The Erlang docs do not specify a recommended value to use between two successive samples
    # of scheduler utilization.
    @scheduler_wall_time_measurement_duration 100

    def scheduler_utilization do
      # Perform the measurement in a task to ensure that the `scheduler_wall_time` flag does
      # not remain enabled in case of unforeseen errors.
      t =
        Task.async(fn ->
          :erlang.system_flag(:scheduler_wall_time, true)
          s1 = :scheduler.get_sample()
          Process.sleep(@scheduler_wall_time_measurement_duration)
          s2 = :scheduler.get_sample()
          {s1, s2}
        end)

      {s1, s2} = Task.await(t)

      schedulers = :scheduler.utilization(s1, s2)

      utilization =
        Map.new(schedulers, fn
          # Scheduler utilization of a normal scheduler with number scheduler_id
          {:normal, scheduler_id, util, _percent} -> {:"normal_#{scheduler_id}", util * 100}
          # Scheduler utilization of a dirty-cpu scheduler with number scheduler_id
          {:cpu, scheduler_id, util, _percent} -> {:"cpu_#{scheduler_id}", util * 100}
          # Total utilization of all normal and dirty-cpu schedulers
          {:total, util, _percent} -> {:total, util * 100}
          # Total utilization of all normal and dirty-cpu schedulers, weighted against maximum amount of available CPU time
          {:weighted, util, _percent} -> {:weighted, util * 100}
        end)

      :telemetry.execute([:vm, :scheduler_utilization], utilization)
    end

    def run_queue_lengths(scheduler_ids) do
      run_queue_lengths = :erlang.statistics(:run_queue_lengths_all)

      measurements =
        Enum.zip(scheduler_ids, run_queue_lengths)
        |> Map.new()
        |> Map.put(:total, :erlang.statistics(:total_run_queue_lengths))
        |> Map.put(:total_plus_io, :erlang.statistics(:total_run_queue_lengths_all))

      :telemetry.execute([:vm, :run_queue_lengths], measurements)
    end

    def garbage_collection(word_size) do
      {num_gc_runs, num_words_reclaimed, 0} = :erlang.statistics(:garbage_collection)

      :telemetry.execute([:vm, :garbage_collection], %{
        total_runs: num_gc_runs,
        total_bytes_reclaimed: num_words_reclaimed * word_size
      })
    end

    def reductions do
      {total_reductions, reductions_since_last_call} = :erlang.statistics(:reductions)

      :telemetry.execute([:vm, :reductions], %{
        total: total_reductions,
        delta: reductions_since_last_call
      })
    end

    def get_system_load_average do
      case :erlang.system_info(:logical_processors) do
        cores when is_number(cores) and cores > 0 ->
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
          |> Enum.reduce(%{}, fn probe, acc ->
            case apply(:cpu_sup, probe, []) do
              {:error, reason} ->
                Logger.debug("Failed to collect system load #{probe}: #{inspect(reason)}")
                acc

              value ->
                Map.put(acc, probe, 100 * (value / 256 / cores))
            end
          end)
          |> case do
            x when x == %{} -> :ok
            map -> :telemetry.execute([:system, :load_percent], map)
          end

        _ ->
          Logger.debug("Failed to collect system load average: no cores reported")
      end
    end

    @required_system_memory_keys ~w[system_total_memory free_memory]a

    def get_system_memory_usage() do
      system_memory = Map.new(:memsup.get_system_memory_data())

      # Sanity-check that all the required keys are present before doing any arithmetic on them
      missing_system_memory_keys =
        Enum.reject(@required_system_memory_keys, &Map.has_key?(system_memory, &1))

      mem_stats =
        cond do
          missing_system_memory_keys != [] ->
            Logger.warning(
              "Error gathering system memory stats: " <>
                "missing data points #{Enum.join(missing_system_memory_keys, ", ")}"
            )

            %{}

          system_memory.system_total_memory == 0 ->
            Logger.warning("Error gathering system memory stats: zero total memory reported")
            %{}

          true ->
            total = system_memory.system_total_memory

            used = total - system_memory.free_memory

            mem_stats =
              system_memory
              |> Map.take(~w[available_memory free_memory buffered_memory cached_memory]a)
              |> Map.put(:used_memory, used)
              |> Map.merge(resident_memory(system_memory))

            mem_percent_stats = Map.new(mem_stats, fn {k, v} -> {k, 100 * v / total} end)

            mem_stats = Map.put(mem_stats, :total_memory, total)

            :telemetry.execute([:system, :memory], mem_stats)
            :telemetry.execute([:system, :memory_percent], mem_percent_stats)

            mem_stats
        end

      Map.merge(mem_stats, swap_stats(:os.type(), system_memory))
    end

    defp resident_memory(%{available_memory: available_memory}) do
      %{resident_memory: available_memory}
    end

    defp resident_memory(%{
           free_memory: free,
           buffered_memory: buffered,
           cached_memory: cached,
           system_total_memory: total
         }) do
      %{resident_memory: total - (free + buffered + cached)}
    end

    @resident_memory_keys ~w[available_memory free_memory buffered_memory cached_memory]a
    defp resident_memory(system_memory) do
      missing_keys =
        @resident_memory_keys
        |> Enum.reject(&Map.has_key?(system_memory, &1))

      Logger.warning(
        "Error gathering resident memory stats: " <>
          "missing data points #{Enum.join(missing_keys, ", ")}"
      )

      %{}
    end

    defp swap_stats({:unix, :darwin}, _system_memory) do
      # On macOS, swap stats are not available
      %{}
    end

    defp swap_stats(_os_type, %{total_swap: total, free_swap: free}) do
      used = total - free

      swap_stats = %{total_swap: total, free_swap: free, used_swap: used}

      swap_percent_stats =
        if total > 0 do
          %{free_swap: 100 * free / total, used_swap: 100 * used / total}
        else
          %{free_swap: 0, used_swap: 0}
        end

      :telemetry.execute([:system, :swap], swap_stats)
      :telemetry.execute([:system, :swap_percent], swap_percent_stats)

      swap_stats
    end

    @required_swap_keys ~w[total_swap free_swap]a
    defp swap_stats(_os_type, system_memory) do
      missing_swap_keys = Enum.reject(@required_swap_keys, &Map.has_key?(system_memory, &1))

      Logger.warning(
        "Error gathering system swap stats: " <>
          "missing data points #{Enum.join(missing_swap_keys, ", ")}"
      )

      %{}
    end

    defp mean([]), do: nil

    defp mean(list) when is_list(list) do
      Enum.sum(list) / Enum.count(list)
    end
  end
end
