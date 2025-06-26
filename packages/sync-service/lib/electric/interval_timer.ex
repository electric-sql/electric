defmodule Electric.Telemetry.IntervalTimer do
  @moduledoc """
  Times intervals between calls to `start_interval/2`. This is useful if you
  want to find out which part of a process took the longest time. It works
  out simpler than wrapping each part of the process in a timer, and
  guarentees no gaps in the timings.
  """

  @default_state []

  def start_interval(state \\ nil, interval_name) do
    [{interval_name, time()} | state || @default_state]
  end

  def durations(state) do
    calculate_durations(state, time())
    |> Enum.reverse()
  end

  def total_time([]), do: 0

  def total_time(durations) do
    durations
    |> Enum.map(fn {_, duration} -> duration end)
    |> Enum.sum()
  end

  defp calculate_durations([{interval_name, start_time} | rest], end_time) do
    duration = {interval_name, end_time - start_time}
    # since we're moving backwards through the intervals, the next interval's end time
    # is this interval's start time:
    [duration | calculate_durations(rest, _next_interval_end_time = start_time)]
  end

  defp calculate_durations([], _), do: []

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

  def extract_state do
    state = state()
    wipe_state()
    state
  end

  def wipe_state do
    Process.delete(@state_key)
  end

  def start_interval(interval_name) do
    IntervalTimer.start_interval(state(), interval_name)
    |> set_state()
  end

  def durations do
    IntervalTimer.durations(state())
  end
end
