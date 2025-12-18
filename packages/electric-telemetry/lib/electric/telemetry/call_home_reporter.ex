defmodule ElectricTelemetry.CallHomeReporter do
  @moduledoc """
  Reporter that collects runtime telemetry information and sends it to a configured
  home server once in a while. The information is aggregated over a period of time,
  with percentile values calculated for the metrics that have them.
  """

  use GenServer

  require Logger

  alias Telemetry.Metrics
  alias ElectricTelemetry.Measurement

  @type metric :: Telemetry.Metrics.t()
  @type report_format :: keyword(metric() | report_format())

  def start_link(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    metrics = Keyword.fetch!(opts, :metrics)
    static_info = Keyword.get(opts, :static_info, %{})
    first_report_in = cast_time_to_ms(Keyword.fetch!(opts, :first_report_in))
    reporting_period = cast_time_to_ms(Keyword.fetch!(opts, :reporting_period))
    reporter_fn = Keyword.get(opts, :reporter_fn, &report_home/2)
    stack_id = Keyword.get(opts, :stack_id)
    telemetry_url = Keyword.fetch!(opts, :call_home_url)

    init_opts = %{
      metrics: metrics,
      first_report_in: first_report_in,
      reporting_period: reporting_period,
      name: name,
      static_info: static_info,
      reporter_fn: reporter_fn,
      stack_id: stack_id,
      telemetry_url: telemetry_url
    }

    GenServer.start_link(__MODULE__, init_opts, name: name)
  end

  def report_home(telemetry_url, results) do
    # Isolate the request in a separate task to avoid blocking and
    # to not receive any messages from the HTTP pool internals.
    # The task process must be linked to CallHomeReporter to avoid orphaned processes when the
    # CallHomeReporter is shut down deliberately by its supervisor.
    Task.async(fn -> Req.post!(telemetry_url, json: results, retry: :transient) end)
    :ok
  end

  def print_stats(name \\ __MODULE__) do
    GenServer.call(name, :print_stats)
  end

  defp cast_time_to_ms({time, :minute}), do: time * 60 * 1000
  defp cast_time_to_ms({time, :second}), do: time * 1000
  defp cast_time_to_ms({time, :millisecond}), do: time

  @impl GenServer
  def init(opts) do
    %{
      metrics: metrics,
      first_report_in: first_report_in,
      reporting_period: reporting_period,
      name: name,
      static_info: static_info,
      reporter_fn: reporter_fn,
      stack_id: stack_id
    } = opts

    # We need to trap exits here so that `terminate/2` callback has more chances to run
    # and send data before crash/shutdown
    Process.flag(:trap_exit, true)
    Process.set_label({:call_home_reporter, name})

    if stack_id do
      Logger.metadata(stack_id: stack_id)
    end

    Logger.notice(
      "Starting telemetry reporter. Electric will send anonymous usage data to #{opts.telemetry_url}. " <>
        "You can configure this with `ELECTRIC_USAGE_REPORTING` environment variable, " <>
        "see https://electric-sql.com/docs/reference/telemetry for more information."
    )

    metrics = save_target_path_to_options(metrics)

    groups = Enum.group_by(metrics, & &1.event_name)

    measurement_ctx = Measurement.init(name)

    # Attach a listener per event
    handler_ids =
      for {event, metrics} <- groups do
        id = {__MODULE__, event, self()}
        :telemetry.attach(id, event, &__MODULE__.handle_event/4, {metrics, measurement_ctx})
        id
      end

    # Save some information about the metrics to use when building an output object
    summary_types =
      metrics
      |> Enum.flat_map(fn
        %Metrics.Summary{unit: :unique} = m -> [{get_result_path(m), :count_unique}]
        %Metrics.Summary{} = m -> [{get_result_path(m), :summary}]
        _ -> []
      end)
      |> Map.new()

    all_paths = Enum.map(metrics, &get_result_path/1)

    clearable_paths =
      metrics
      |> Enum.reject(&Keyword.get(&1.reporter_options, :persist_between_sends, false))
      |> Enum.map(&get_result_path/1)

    Process.send_after(self(), :report, first_report_in)

    {:ok,
     %{
       telemetry_url: opts.telemetry_url,
       measurement_ctx: measurement_ctx,
       handler_ids: handler_ids,
       summary_types: summary_types,
       all_paths: all_paths,
       reporting_period: reporting_period,
       static_info: static_info,
       clearable_paths: clearable_paths,
       reporter_fn: reporter_fn,
       last_reported: DateTime.utc_now()
     }}
  end

  @impl GenServer
  def terminate(_, state) do
    for id <- state.handler_ids do
      :telemetry.detach(id)
    end

    # On shutdown try to push all the data we still can.
    state.reporter_fn.(state.telemetry_url, build_report(state))
  end

  @impl GenServer
  def handle_call(:print_stats, _from, state) do
    {:reply, build_stats(state), state}
  end

  @impl GenServer
  def handle_info(:report, state) do
    full_report = build_report(state)

    state =
      try do
        :ok = state.reporter_fn.(state.telemetry_url, full_report)
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

  # Catch-all clauses to handle the result, EXIT and DOWN messages from the async task started in `report_home()`.
  def handle_info({task_mon, %Req.Response{}}, state) when is_reference(task_mon) do
    {:noreply, state}
  end

  def handle_info({:EXIT, _, _}, state) do
    {:noreply, state}
  end

  def handle_info({:DOWN, _, :process, _, _}, state) do
    {:noreply, state}
  end

  defp build_report(state) do
    %{
      last_reported: state.last_reported,
      timestamp: DateTime.utc_now(),
      report_version: 2,
      data: build_stats(state)
    }
  end

  defp build_stats(state) do
    state.all_paths
    |> Enum.map(fn path ->
      default =
        case state.summary_types[path] do
          :summary -> %{min: 0, max: 0, mean: 0}
          _ -> 0
        end

      {path, Measurement.calc_metric(state.measurement_ctx, path, default)}
    end)
    |> Enum.reduce(%{}, fn {path, val}, acc ->
      path = path |> Tuple.to_list() |> Enum.map(&Access.key(&1, %{}))
      put_in(acc, path, val)
    end)
    |> deep_merge(state.static_info)
  end

  defp clear_stats(state) do
    for key <- state.clearable_paths do
      Measurement.clear_metric(state.measurement_ctx, key)
    end

    state
  end

  def handle_event(_event_name, measurements, metadata, {metrics, measurement_ctx}) do
    for %{reporter_options: opts} = metric <- metrics, keep?(metric, metadata) do
      path = Keyword.fetch!(opts, :result_path)
      measurement = extract_measurement(metric, measurements, metadata)

      case metric do
        %Metrics.Counter{} ->
          Measurement.handle_counter(measurement_ctx, path)

        %Metrics.Sum{} ->
          Measurement.handle_sum(measurement_ctx, path, measurement)

        %Metrics.LastValue{} ->
          Measurement.handle_last_value(measurement_ctx, path, measurement)

        %Metrics.Summary{unit: :unique} ->
          value = metadata[Keyword.fetch!(opts, :count_unique)]
          Measurement.handle_unique_count(measurement_ctx, path, value)

        %Metrics.Summary{} ->
          Measurement.handle_summary(measurement_ctx, path, measurement)
      end
    end
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
        if v.tags != [],
          do: raise("Call home reporter doesn't support splitting metrics by tags")

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
