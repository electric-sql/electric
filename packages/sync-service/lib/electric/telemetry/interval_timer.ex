defmodule Electric.Telemetry.IntervalTimer do
  @default_state []

  def start_interval(state \\ nil, interval) do
    [{interval, time()} | state || @default_state]
  end

  def intervals(state) do
    calculate_intervals([time() | state])
    |> Enum.reverse()
  end

  def total_time([]), do: 0

  def total_time(intervals) do
    intervals
    |> Enum.map(fn {_, duration} -> duration end)
    |> Enum.sum()
  end

  defp calculate_intervals([end_time, {interval, start_time} | rest]) do
    [{interval, end_time - start_time} | calculate_intervals([start_time | rest])]
  end

  defp calculate_intervals([_end_time]), do: []

  defp time do
    System.monotonic_time(:microsecond)
  end
end

defmodule Electric.Telemetry.ProcessIntervalTimer do
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

  def intervals do
    IntervalTimer.intervals(state())
  end
end
