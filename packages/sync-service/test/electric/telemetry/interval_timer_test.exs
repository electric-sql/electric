defmodule Electric.Telemetry.IntervalTimerTest do
  use ExUnit.Case, async: true

  alias Electric.Telemetry.ProcessIntervalTimer

  @a_time 2
  @b_time 5
  @c_time 9
  @μs_per_ms 1000
  @rounding_error 1

  test "times how long each interval takes" do
    {total, intervals} =
      :timer.tc(fn ->
        ProcessIntervalTimer.start_interval("A")
        Process.sleep(@a_time)
        ProcessIntervalTimer.start_interval("B")
        Process.sleep(@b_time)
        ProcessIntervalTimer.start_interval("C")
        Process.sleep(@c_time)

        ProcessIntervalTimer.intervals()
      end)

    assert [{"A", a_time}, {"B", b_time}, {"C", c_time}] = intervals

    assert a_time >= @a_time * @μs_per_ms
    assert b_time >= @b_time * @μs_per_ms
    assert c_time >= @c_time * @μs_per_ms
    assert a_time + b_time + c_time <= total + @rounding_error
  end
end
