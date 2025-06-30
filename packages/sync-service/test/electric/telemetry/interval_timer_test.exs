defmodule Electric.Telemetry.IntervalTimerTest do
  use ExUnit.Case, async: true

  alias Electric.Telemetry.IntervalTimer

  @a_time 2
  @b_time 5
  @c_time 9
  @μs_per_ms 1000
  @rounding_error 1

  test "times how long each interval takes" do
    {total, intervals} =
      :timer.tc(fn ->
        timer = IntervalTimer.start_interval("A")
        Process.sleep(@a_time)
        timer = IntervalTimer.start_interval(timer, "B")
        Process.sleep(@b_time)
        timer = IntervalTimer.start_interval(timer, "C")
        Process.sleep(@c_time)

        IntervalTimer.durations(timer)
      end)

    assert [{"A", a_time}, {"B", b_time}, {"C", c_time}] = intervals

    assert a_time >= @a_time * @μs_per_ms
    assert b_time >= @b_time * @μs_per_ms
    assert c_time >= @c_time * @μs_per_ms
    assert a_time + b_time + c_time <= total + @rounding_error
  end
end
