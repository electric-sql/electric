defmodule Electric.Telemetry.CallHomeReporter do
  @moduledoc """
  Reporter that collects runtime telemetry information and sends it to a configured
  home server once in a while.
  """
  use GenServer
  require Logger
  alias Telemetry.Metrics

  @type metric :: Telemetry.Metrics.t()
  @type report_format :: keyword(metric() | report_format())

  def start_link(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    metrics = Keyword.fetch!(opts, :metrics)
    static_info = Keyword.get(opts, :static_info, %{})
    first_report_in = cast_time_to_ms(Keyword.fetch!(opts, :first_report_in))
    reporting_period = cast_time_to_ms(Keyword.fetch!(opts, :reporting_period))
    reporter_fn = Keyword.fetch!(opts, :reporter_fn)

    GenServer.start_link(
      __MODULE__,
      {metrics, first_report_in, reporting_period, name, static_info, reporter_fn},
      name: name
    )
  end

  def report_home(results) do
    url = Application.fetch_env!(:electric, :telemetry_url)

    Req.post!(url, json: results, retry: :transient)
    :ok
  end

  def print_stats(name \\ __MODULE__) do
    GenServer.call(name, :print_stats)
  end

  defp cast_time_to_ms({time, :minute}), do: time * 60 * 1000
  defp cast_time_to_ms({time, :second}), do: time * 1000

  @impl GenServer
  def init({metrics, first_report_in, reporting_period, name, static_info, reporter_fn}) do
    # We need to trap exits here so that `terminate/2` callback has more chances to run
    # and send data before crash/shutdown
    Process.flag(:trap_exit, true)

    metrics = save_target_path_to_options(metrics)

    groups = Enum.group_by(metrics, & &1.event_name)

    aggregates_table = create_table(name, :set)
    summary_table = create_table(String.to_atom("#{name}_summary"), :duplicate_bag)

    context = %{
      table: aggregates_table,
      summary_table: summary_table
    }

    # Attach a listener per event
    for {event, metrics} <- groups do
      id = {__MODULE__, event, self()}
      :telemetry.attach(id, event, &__MODULE__.handle_event/4, {metrics, context})
    end

    # Save some information about the metrics to use when building an output object
    summary_types =
      metrics
      |> Enum.flat_map(fn
        %Metrics.Summary{unit: :unique} = m -> [{get_result_path(m), :count_unique}]
        %Metrics.Summary{} = m -> [{get_result_path(m), :summary}]
        _ -> []
      end)

    all_paths = Enum.map(metrics, &get_result_path/1)

    persisted_paths =
      metrics
      |> Enum.filter(&Keyword.get(&1.reporter_options, :persist_between_sends, false))
      |> Enum.map(&get_result_path/1)

    Process.send_after(self(), :report, first_report_in)

    {:ok,
     Map.merge(context, %{
       event_ids: Map.keys(groups),
       summary_types: summary_types,
       all_paths: all_paths,
       reporting_period: reporting_period,
       static_info: static_info,
       persisted_paths: persisted_paths,
       reporter_fn: reporter_fn,
       last_reported: nil
     })}
  end

  @impl GenServer
  def terminate(_, state) do
    for id <- state.event_ids do
      :telemetry.detach(id)
    end

    # On shutdown try to push all the data we still can.
    state.reporter_fn.(build_report(state))
  end

  @empty_summary %{
    min: 0,
    max: 0,
    mean: 0,
    median: 0,
    mode: nil
  }

  @impl GenServer
  def handle_call(:print_stats, _from, state) do
    {:reply, build_stats(state), state}
  end

  @impl GenServer
  def handle_info(:report, state) do
    full_report = build_report(state)

    state =
      try do
        :ok = state.reporter_fn.(full_report)
        clear_stats(%{state | last_reported: full_report.timestamp})
      rescue
        e ->
          Logger.warning(
            "Reporter function failed while trying to send telemetry data.\nError: #{Exception.format(:error, e, __STACKTRACE__)}"
          )

          state
      end

    # If we've failed to send the results for more than 24 hours, then drop current stats
    # to save memory
    state =
      if DateTime.diff(DateTime.utc_now(), state.last_reported, :hour) >= 24 do
        clear_stats(%{state | last_reported: DateTime.utc_now()})
      else
        state
      end

    Process.send_after(self(), :report, state.reporting_period)
    {:noreply, state}
  end

  defp build_report(state) do
    %{
      last_reported: state.last_reported,
      timestamp: DateTime.utc_now(),
      data: build_stats(state)
    }
  end

  defp build_stats(state) do
    result = empty_result(state.all_paths, Map.new(state.summary_types))

    result =
      :ets.tab2list(state.table)
      |> fill_map_from_path_tuples(result)

    result =
      state.summary_types
      |> Enum.map(&{elem(&1, 0), calculate_summary(&1, state.summary_table)})
      |> fill_map_from_path_tuples(result)

    deep_merge(result, state.static_info)
  end

  defp clear_stats(state) do
    for key <- state.all_paths -- state.persisted_paths do
      table =
        if(is_map_key(Map.new(state.summary_types), key),
          do: state.summary_table,
          else: state.table
        )

      :ets.delete(table, key)
    end

    state
  end

  defp calculate_summary({path, :count_unique}, table) do
    :ets.lookup_element(table, path, 2)
    |> Enum.uniq()
    |> Enum.count()
  rescue
    ArgumentError -> 0
  end

  defp calculate_summary({path, :summary}, table) do
    items = :ets.lookup_element(table, path, 2)

    length = length(items)

    {min, max} = Enum.min_max(items)

    %{
      min: min,
      max: max,
      mean: mean(items, length),
      median: median(items, length),
      mode: mode(items)
    }
  rescue
    ArgumentError ->
      @empty_summary
  end

  defp mean(elements, length), do: Enum.sum(elements) / length

  defp median(elements, length) when rem(length, 2) == 1 do
    Enum.at(elements, div(length, 2))
  end

  defp median(elements, length) when rem(length, 2) == 0 do
    Enum.slice(elements, div(length, 2) - 1, 2) |> mean(length)
  end

  defp mode(elements), do: Enum.frequencies(elements) |> Enum.max_by(&elem(&1, 1)) |> elem(0)

  defp empty_result(all_paths, summary_types) do
    all_paths
    |> Enum.map(fn path ->
      case summary_types do
        %{^path => :summary} -> {path, @empty_summary}
        %{^path => :unique_count} -> {path, 0}
        _ -> {path, 0}
      end
    end)
    |> fill_map_from_path_tuples()
  end

  @spec fill_map_from_path_tuples([{tuple(), term()}], map()) :: map()
  defp fill_map_from_path_tuples(tuples, into \\ %{}) do
    Enum.reduce(tuples, into, fn {path, val}, acc ->
      path = path |> Tuple.to_list() |> Enum.map(&Access.key(&1, %{}))
      put_in(acc, path, val)
    end)
  end

  @spec create_table(name :: atom, type :: atom) :: :ets.tid() | atom
  defp create_table(name, type) do
    :ets.new(name, [:named_table, :public, type, {:write_concurrency, true}])
  end

  def handle_event(_event_name, measurements, metadata, {metrics, context}) do
    for %{reporter_options: opts} = metric <- metrics, keep?(metric, metadata) do
      path = Keyword.fetch!(opts, :result_path)
      measurement = extract_measurement(metric, measurements, metadata)

      case metric do
        %Metrics.Counter{} ->
          :ets.update_counter(context.table, path, 1, {path, 0})

        %Metrics.Sum{} ->
          :ets.update_counter(context.table, path, measurement, {path, 0})

        %Metrics.LastValue{} ->
          :ets.insert(context.table, {path, measurement})

        %Metrics.Summary{unit: :unique} ->
          add_to_summary(path, context, metadata[Keyword.fetch!(opts, :count_unique)])

        %Metrics.Summary{} ->
          add_to_summary(path, context, measurement)
      end
    end
  end

  defp add_to_summary(path, %{summary_table: tbl}, value) do
    :ets.insert(tbl, {path, value})
  end

  defp keep?(%{keep: nil}, _metadata), do: true
  defp keep?(metric, metadata), do: metric.keep.(metadata)

  defp extract_measurement(metric, measurements, metadata) do
    case metric.measurement do
      fun when is_function(fun, 2) -> fun.(measurements, metadata)
      fun when is_function(fun, 1) -> fun.(measurements)
      key -> measurements[key]
    end
  end

  @spec save_target_path_to_options(report_format()) :: [metric()]
  defp save_target_path_to_options(report, prefix \\ []) when is_list(report) do
    Enum.flat_map(report, fn
      {k, v} when is_list(v) ->
        save_target_path_to_options(v, prefix ++ [k])

      {k, v} ->
        if v.tags != [], do: raise("Call home reporter doesn't support splitting metrics by tags")

        [
          Map.update!(
            v,
            :reporter_options,
            &Keyword.put(&1, :result_path, List.to_tuple(prefix ++ [k]))
          )
        ]
    end)
  end

  defp get_result_path(%{reporter_options: opts}), do: Keyword.fetch!(opts, :result_path)

  def deep_merge(left, right) do
    Map.merge(left, right, fn
      _, %{} = l, %{} = r -> deep_merge(l, r)
      _, _, r -> r
    end)
  end
end
