defmodule Electric.Telemetry.IntervalTimerTest do
  use ExUnit.Case, async: true

  alias Electric.Telemetry.IntervalTimer

  test "times how long each interval takes" do
    timer = IntervalTimer.init()
    timer = IntervalTimer.start_interval(timer, "A", time: 10)
    timer = IntervalTimer.start_interval(timer, "B", time: 20)
    timer = IntervalTimer.start_interval(timer, "C", time: 25)

    assert [{"A", 10}, {"B", 5}, {"C", 2}] = IntervalTimer.durations(timer, time: 27)
  end

  test "records nothing if timer is not initialized" do
    assert nil == IntervalTimer.start_interval(nil, "A")

    assert [] = IntervalTimer.durations(nil)
  end
end
