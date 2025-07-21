defmodule Electric.Telemetry.IntervalTimer do
  @moduledoc """
  Times intervals between calls to `start_interval/2`. This is useful if you
  want to find out which part of a process took the longest time. It works
  out simpler than wrapping each part of the process in a timer, and
  guarentees no gaps in the timings.

  The simplest way to use the timer is to store the timer state in the 
  process memory, see `OpenTelemetry.start_interval`. This module should
  only be used directly if you do not want to use the process memory.
  """

  @type t() :: [{binary(), non_neg_integer()}]

  def init, do: []

  def start_interval(state, interval_name, opts \\ []) do
    [{interval_name, time(opts)} | state]
  end

  def durations(state, opts \\ []) do
    calculate_durations(state, time(opts))
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

  defp time(opts) do
    opts[:time] || System.monotonic_time(:microsecond)
  end
end
