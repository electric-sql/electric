defmodule Electric.Telemetry.IntervalTimer do
  @moduledoc """
  Times intervals between calls to `start_interval/2`. This is useful when it is difficult to wrap an interval in a span, the state
  can just be passed around instead, or kept in the process memory using `ProcessIntervalTimer`.
  """

  @default_state []

  def start_interval(state \\ nil, interval) do
    [{interval, time()} | state || @default_state]
  end

  def durations(state) do
    calculate_durations([time() | state])
    |> Enum.reverse()
  end

  def total_time([]), do: 0

  def total_time(durations) do
    durations
    |> Enum.map(fn {_, duration} -> duration end)
    |> Enum.sum()
  end

  defp calculate_durations([end_time, {interval, start_time} | rest]) do
    [{interval, end_time - start_time} | calculate_durations([start_time | rest])]
  end

  defp calculate_durations([_end_time]), do: []

  defp time do
    System.monotonic_time(:microsecond)
  end
end

defmodule Electric.Telemetry.ProcessIntervalTimer do
  @moduledoc """
  Times intervals between calls to `start_interval/2`. This is useful when it is difficult to wrap an interval in a span, the state
  is stored in the process memory, allowing it to be accessed from any function on the process.
  """
  alias Electric.Telemetry.IntervalTimer

  @state_key :timed_intervals

  def state do
    Process.get(@state_key, [])
  end

  def set_state(state) do
    Process.put(@state_key, state)
  end

  def wipe_state do
    Process.delete(@state_key)
  end

  def start_interval(interval) do
    IntervalTimer.start_interval(state(), interval)
    |> set_state()
  end

  def durations do
    IntervalTimer.durations(state())
  end
end
