defmodule Electric.Telemetry.IntervalTimer do
  @state_key :timed_intervals

  def state do
    Process.get(@state_key, [])
  end

  def set_state(state) do
    Process.put(@state_key, state)
  end

  def start(interval) do
    [{interval, time()} | state()]
    |> set_state()
  end

  def intervals do
    intervals([time() | state()])
    |> Enum.reverse()
  end

  defp intervals([end_time, {interval, start_time} | rest]) do
    [{interval, end_time - start_time} | intervals([start_time | rest])]
  end

  defp intervals([_end_time]), do: []

  defp time do
    System.monotonic_time(:microsecond)
  end
end
