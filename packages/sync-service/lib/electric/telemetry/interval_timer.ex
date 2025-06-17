defmodule Electric.Telemetry.IntervalTimer do
  def start(state, interval) do
    [{interval, time()} | state]
  end

  def intervals(state) do
    calculate_intervals([time() | state])
    |> Enum.reverse()
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

  def start(interval) do
    IntervalTimer.start(state(), interval)
    |> set_state()
  end

  def intervals do
    IntervalTimer.intervals(state())
  end
end
