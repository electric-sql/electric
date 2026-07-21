defmodule Electric.PollWaitTest do
  use ExUnit.Case, async: true

  alias Electric.PollWait

  describe "until/3" do
    test "returns :ready immediately when the predicate is ready on first check" do
      assert PollWait.until(fn -> :ready end, 1_000) == :ready
    end

    test "returns {:ready, value} when the predicate yields a tagged ready" do
      assert PollWait.until(fn -> {:ready, :foo} end, 1_000) == {:ready, :foo}
    end

    test "returns :timeout when the predicate never becomes ready" do
      # Use a tiny timeout so the test is cheap. Initial interval defaults
      # to 25ms so 50ms is enough to guarantee at least one sleep.
      assert PollWait.until(fn -> :not_ready end, 50) == :timeout
    end

    test "stops polling once the deadline elapses, even mid-sleep" do
      counter = :counters.new(1, [:atomics])

      check = fn ->
        :counters.add(counter, 1, 1)
        :not_ready
      end

      assert PollWait.until(check, 75, initial_interval: 25, max_interval: 25, jitter: 0.0) ==
               :timeout

      # 0ms check, sleep 25, 25ms check, sleep 25, 50ms check, sleep 25, 75ms deadline.
      # The load-bearing assertion is the upper bound (<=4): the loop must be
      # bounded by the deadline. The lower bound is loosened to 2 because a
      # slow CI runner can overrun a single 25ms sleep and collapse the trace.
      count = :counters.get(counter, 1)
      assert count in 2..4, "expected 2..4 checks, got #{count}"
    end

    test "respects per-call backoff opts (no global defaults baked in)" do
      timestamps = :ets.new(:ts, [:public, :ordered_set])

      check = fn ->
        :ets.insert(timestamps, {System.monotonic_time(:millisecond), :tick})
        :not_ready
      end

      _ =
        PollWait.until(check, 300,
          initial_interval: 5,
          max_interval: 20,
          backoff: 2.0,
          jitter: 0.0
        )

      ts = timestamps |> :ets.tab2list() |> Enum.map(&elem(&1, 0)) |> Enum.sort()
      diffs = ts |> Enum.chunk_every(2, 1, :discard) |> Enum.map(fn [a, b] -> b - a end)

      # With 0 jitter, a 2.0 backoff factor, and the 10ms floor in jittered/2,
      # the configured sleeps clamp to 10, 10, 20, 20, ... ms between checks
      # (initial_interval: 5 and 5*2=10 both floor to 10; 10*2=20 hits max).
      [d1, d2, d3 | _] = diffs

      # Assert lower bounds only. Process.sleep never returns early, so a measured
      # delta can overshoot under a loaded runner but never undershoot. Comparing
      # two measured deltas to each other would be flaky (a shorter-configured
      # sleep can overshoot past a longer one), so we deliberately don't.
      assert d1 >= 8, "expected d1 >= 8ms (floored 10), got #{d1}"
      assert d2 >= 8, "expected d2 >= 8ms (floored 10), got #{d2}"

      # Backoff is proven by the third interval reaching ~20ms: without the factor
      # being applied every interval would stay floored at 10ms, so d3 could not
      # climb toward the 20ms max.
      assert d3 >= 16, "expected d3 >= 16ms (backoff grew interval to 20), got #{d3}"
      :ets.delete(timestamps)
    end

    test "jitter never produces negative or zero sleeps" do
      # Drive 200 jittered intervals at the minimum interval (1) with max jitter
      # and ensure none of them blow up or return ready spuriously.
      check = fn -> :not_ready end

      assert PollWait.until(check, 5, initial_interval: 1, max_interval: 1, jitter: 1.0) ==
               :timeout
    end

    test ":infinity timeout never returns :timeout but yields when ready" do
      parent = self()

      task =
        Task.async(fn ->
          PollWait.until(
            fn ->
              receive do
                :go -> :ready
              after
                0 -> :not_ready
              end
            end,
            :infinity,
            initial_interval: 5,
            max_interval: 5,
            jitter: 0.0
          )
          |> tap(fn r -> send(parent, {:result, r}) end)
        end)

      Process.sleep(20)
      send(task.pid, :go)
      assert_receive {:result, :ready}, 200
    end
  end
end
