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

      [telemetry_poller_child_spec(opts) | exporter_child_specs(opts)]
      |> Supervisor.init(strategy: :one_for_one)
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
      [
        last_value("system.cpu.core_count"),
        last_value("system.cpu.utilization.total"),
        last_value("vm.memory.processes_used", unit: :byte),
        last_value("vm.memory.processes_by_type", tags: [:process_type], unit: :byte),
        last_value("vm.memory.binary", unit: :byte),
        last_value("vm.memory.ets", unit: :byte),
        last_value("vm.system_counts.process_count"),
        last_value("vm.system_counts.atom_count"),
        last_value("vm.system_counts.port_count"),
        last_value("vm.total_run_queue_lengths.total"),
        last_value("vm.total_run_queue_lengths.cpu"),
        last_value("vm.total_run_queue_lengths.io"),
        last_value("vm.uptime.total",
          unit: :second,
          measurement: &:erlang.convert_time_unit(&1.total, :native, :second)
        ),
        last_value("vm.memory.total", unit: :byte)
      ] ++
        Enum.map(
          # Add "system.cpu.utilization.core_*" but since there's no wildcard support we
          # explicitly add the cores here.
          0..(:erlang.system_info(:logical_processors) - 1),
          &last_value("system.cpu.utilization.core_#{&1}")
        )
    end

    defp otel_metrics(opts) do
      [
        last_value("system.load_percent.avg1"),
        last_value("system.load_percent.avg5"),
        last_value("system.load_percent.avg15")
      ] ++
        prometheus_metrics() ++
        memory_by_process_type_metrics(opts)
    end

    defp memory_by_process_type_metrics(%{otel_per_process_metrics?: true}) do
      [
        last_value("vm.memory.processes_by_type", tags: [:process_type], unit: :byte)
      ]
    end

    defp memory_by_process_type_metrics(_), do: []

    defp periodic_measurements(opts) do
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
        {__MODULE__, :memory_by_process_type, [opts]},
        {__MODULE__, :get_system_load_average, []},
        {__MODULE__, :get_system_memory_usage, []}
      ]
    end

    def uptime_event do
      :telemetry.execute([:vm, :uptime], %{
        total: :erlang.monotonic_time() - :erlang.system_info(:start_time)
      })
    end

    def memory_by_process_type(%{top_process_count: process_count}) do
      for %{type: type, memory: memory} <-
            Electric.Debug.Process.top_memory_by_type(process_count) do
        :telemetry.execute([:vm, :memory], %{processes_by_type: memory}, %{
          process_type: to_string(type)
        })
      end
    end

    def cpu_utilization do
      cores =
        :cpu_sup.util([:per_cpu])
        |> Map.new(fn {cpu_index, busy, _free, _misc} -> {:"core_#{cpu_index}", busy} end)

      cores
      |> Map.put(:total, cores |> Map.values() |> mean())
      |> then(&:telemetry.execute([:system, :cpu, :utilization], &1))

      :telemetry.execute([:system, :cpu], %{core_count: Enum.count(cores)})
    end

    def get_system_load_average do
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
      |> then(&:telemetry.execute([:system, :load_percent], &1))
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
