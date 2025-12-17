defmodule ElectricTelemetry.ApplicationTelemetry do
  @moduledoc """
  Collects and exports application level telemetry such as CPU, memory and BEAM metrics.

  See also StackTelemetry for stack specific telemetry.
  """
  use Supervisor

  import Telemetry.Metrics

  alias ElectricTelemetry.Reporters

  require Logger

  @behaviour ElectricTelemetry.Poller

  def start_link(opts) do
    with {:ok, opts} <- ElectricTelemetry.validate_options(opts) do
      if ElectricTelemetry.export_enabled?(opts) do
        Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
      else
        # Avoid starting the telemetry supervisor and its telemetry_poller child if we're not
        # intending to export periodic measurements metrics anywhere.
        :ignore
      end
    end
  end

  @impl Supervisor
  def init(opts) do
    children =
      [
        {ElectricTelemetry.SystemMonitor, opts},
        ElectricTelemetry.Poller.child_spec(opts, callback_module: __MODULE__)
        | exporter_child_specs(opts)
      ]
      |> Enum.reject(&is_nil/1)

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp exporter_child_specs(opts) do
    metrics = metrics(opts)

    [
      Reporters.CallHomeReporter.child_spec(
        opts,
        metrics: Reporters.CallHomeReporter.application_metrics()
      ),
      Reporters.Otel.child_spec(opts, metrics: metrics),
      Reporters.Prometheus.child_spec(opts, metrics: metrics),
      Reporters.Statsd.child_spec(opts, metrics: Reporters.Statsd.application_metrics())
    ]
  end

  @impl ElectricTelemetry.Poller
  def builtin_periodic_measurements(telemetry_opts) do
    [
      # Measurements included with the telemetry_poller application.
      #
      # By default, The telemetry_poller application starts its own poller but we disable that
      # and add its default measurements to the list of our custom ones.
      #
      # This allows for all periodic measurements to be defined in one place.
      :memory,
      :persistent_term,
      :system_counts,
      :total_run_queue_lengths
    ] ++
      Enum.map(
        [
          :uptime_event,
          :cpu_utilization,
          :scheduler_utilization,
          :run_queue_lengths,
          :garbage_collection,
          :reductions,
          :process_memory,
          :get_system_load_average,
          :get_system_memory_usage
        ],
        &{__MODULE__, &1, [telemetry_opts]}
      )
  end

  def metrics(telemetry_opts) do
    [
      last_value("process.memory.total", tags: [:process_type], unit: :byte),
      last_value("process.memory.binary", tags: [:process_type], unit: :byte),
      last_value("process.memory.avg_bin_count", tags: [:process_type]),
      last_value("process.memory.avg_ref_count", tags: [:process_type]),
      last_value("system.cpu.core_count"),
      last_value("system.cpu.utilization.total"),
      last_value("system.load_percent.avg1"),
      last_value("system.load_percent.avg5"),
      last_value("system.load_percent.avg15"),
      last_value("system.memory_percent.free_memory"),
      last_value("system.memory_percent.available_memory"),
      last_value("system.memory_percent.used_memory"),
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
      sum("vm.monitor.long_message_queue.length", tags: [:process_type]),
      distribution("vm.monitor.long_schedule.timeout",
        tags: [:process_type],
        unit: :millisecond
      ),
      distribution("vm.monitor.long_gc.timeout", tags: [:process_type], unit: :millisecond),
      last_value("vm.persistent_term.count"),
      last_value("vm.persistent_term.memory", unit: :byte),
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
      cpu_utilization_metrics() ++
      scheduler_utilization_metrics() ++
      run_queue_lengths_metrics() ++
      additional_metrics(telemetry_opts)
  end

  def cpu_utilization_metrics do
    1..:erlang.system_info(:logical_processors)
    |> Enum.map(&last_value("system.cpu.utilization.core_#{&1 - 1}"))
  end

  def scheduler_utilization_metrics do
    num_schedulers = :erlang.system_info(:schedulers)
    schedulers_range = 1..num_schedulers

    num_dirty_cpu_schedulers = :erlang.system_info(:dirty_cpu_schedulers)

    dirty_cpu_schedulers_range =
      (num_schedulers + 1)..(num_schedulers + num_dirty_cpu_schedulers)

    Enum.map(schedulers_range, &last_value("vm.scheduler_utilization.normal_#{&1}")) ++
      Enum.map(dirty_cpu_schedulers_range, &last_value("vm.scheduler_utilization.cpu_#{&1}"))
  end

  def run_queue_lengths_metrics do
    Enum.map(ElectricTelemetry.scheduler_ids(), &last_value("vm.run_queue_lengths.#{&1}"))
  end

  def additional_metrics(%{additional_metrics: metrics}), do: metrics
  def additional_metrics(_), do: []

  ###

  def uptime_event(_) do
    :telemetry.execute([:vm, :uptime], %{
      total: :erlang.monotonic_time() - :erlang.system_info(:start_time)
    })
  end

  def process_memory(%{intervals_and_thresholds: %{top_process_count: process_count}}) do
    for map <- ElectricTelemetry.Processes.top_memory_by_type(process_count) do
      :telemetry.execute(
        [:process, :memory],
        %{
          total: map.proc_mem,
          binary: map.binary_mem,
          avg_bin_count: map.avg_bin_count,
          avg_ref_count: map.avg_ref_count
        },
        %{process_type: to_string(map.type)}
      )
    end
  end

  def cpu_utilization(_) do
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

  def scheduler_utilization(_) do
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

  def run_queue_lengths(_) do
    scheduler_ids = ElectricTelemetry.scheduler_ids()

    run_queue_lengths = :erlang.statistics(:run_queue_lengths_all)

    measurements =
      Enum.zip(scheduler_ids, run_queue_lengths)
      |> Map.new()
      |> Map.put(:total, :erlang.statistics(:total_run_queue_lengths))
      |> Map.put(:total_plus_io, :erlang.statistics(:total_run_queue_lengths_all))

    :telemetry.execute([:vm, :run_queue_lengths], measurements)
  end

  def garbage_collection(_) do
    word_size = :erlang.system_info(:wordsize)
    {num_gc_runs, num_words_reclaimed, 0} = :erlang.statistics(:garbage_collection)

    :telemetry.execute([:vm, :garbage_collection], %{
      total_runs: num_gc_runs,
      total_bytes_reclaimed: num_words_reclaimed * word_size
    })
  end

  def reductions(_) do
    {total_reductions, reductions_since_last_call} = :erlang.statistics(:reductions)

    :telemetry.execute([:vm, :reductions], %{
      total: total_reductions,
      delta: reductions_since_last_call
    })
  end

  def get_system_load_average(_) do
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

  def get_system_memory_usage(_) do
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
