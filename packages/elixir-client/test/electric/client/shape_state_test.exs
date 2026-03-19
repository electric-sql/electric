defmodule Electric.Client.ShapeStateTest do
  use ExUnit.Case, async: true

  alias Electric.Client.ShapeState
  alias Electric.Client.Offset

  describe "check_fast_loop/1" do
    test "returns :ok when below threshold" do
      state = ShapeState.new(offset: Offset.new(1, 0))

      # 4 requests at same offset within window — below threshold of 5
      now = System.monotonic_time(:millisecond)

      state = %{
        state
        | recent_requests: Enum.map(0..2, fn i -> {now - i * 10, Offset.new(1, 0)} end)
      }

      assert {:ok, new_state} = ShapeState.check_fast_loop(state)
      assert length(new_state.recent_requests) == 4
      assert new_state.fast_loop_consecutive_count == 0
    end

    test "returns :ok when requests are at different offsets" do
      state = ShapeState.new(offset: Offset.new(3, 0))

      now = System.monotonic_time(:millisecond)

      # 4 at different offsets + current will be 5 total but only 1 at current offset
      state = %{
        state
        | recent_requests: [
            {now - 10, Offset.new(1, 0)},
            {now - 20, Offset.new(1, 0)},
            {now - 30, Offset.new(2, 0)},
            {now - 40, Offset.new(2, 0)}
          ]
      }

      assert {:ok, _new_state} = ShapeState.check_fast_loop(state)
    end

    test "returns :ok when old entries fall outside the window" do
      state = ShapeState.new(offset: Offset.new(1, 0))

      now = System.monotonic_time(:millisecond)

      # 4 entries from 600ms ago (outside 500ms window) — they'll be pruned
      state = %{
        state
        | recent_requests: Enum.map(0..3, fn i -> {now - 600 - i, Offset.new(1, 0)} end)
      }

      assert {:ok, new_state} = ShapeState.check_fast_loop(state)
      # Old entries pruned, only the new one remains
      assert length(new_state.recent_requests) == 1
    end

    test "first detection clears shape handle, resets offset, and returns backoff 0" do
      state = ShapeState.new(offset: Offset.new(1, 0), shape_handle: "my-handle")

      now = System.monotonic_time(:millisecond)

      # 4 entries at same offset within window — adding one more triggers detection
      state = %{
        state
        | recent_requests: Enum.map(0..3, fn _ -> {now, Offset.new(1, 0)} end)
      }

      assert {:backoff, 0, new_state} = ShapeState.check_fast_loop(state)
      assert new_state.fast_loop_consecutive_count == 1
      assert new_state.recent_requests == []
      # First detection clears shape handle and resets offset
      assert new_state.shape_handle == nil
      assert new_state.offset == Offset.before_all()
    end

    test "subsequent detections return exponential backoff" do
      state = ShapeState.new(offset: Offset.new(1, 0))

      now = System.monotonic_time(:millisecond)

      state = %{
        state
        | recent_requests: Enum.map(0..3, fn _ -> {now, Offset.new(1, 0)} end),
          fast_loop_consecutive_count: 1
      }

      assert {:backoff, delay, new_state} = ShapeState.check_fast_loop(state)
      assert delay > 0
      assert new_state.fast_loop_consecutive_count == 2
      assert new_state.recent_requests == []
    end

    test "returns error after max consecutive detections" do
      state = ShapeState.new(offset: Offset.new(1, 0))

      now = System.monotonic_time(:millisecond)

      state = %{
        state
        | recent_requests: Enum.map(0..3, fn _ -> {now, Offset.new(1, 0)} end),
          fast_loop_consecutive_count: 4
      }

      assert {:error, message} = ShapeState.check_fast_loop(state)
      assert message =~ "stuck in a fast retry loop"
      assert message =~ "proxy or CDN misconfiguration"
      assert message =~ "troubleshooting"
    end
  end

  describe "reset/2" do
    test "clears fast-loop state" do
      state = %{
        ShapeState.new(offset: Offset.new(5, 0), shape_handle: "old-handle")
        | recent_requests: [{0, Offset.new(5, 0)}],
          fast_loop_consecutive_count: 3
      }

      new_state = ShapeState.reset(state, "new-handle")

      assert new_state.shape_handle == "new-handle"
      assert new_state.offset == Offset.before_all()
      assert new_state.recent_requests == []
      assert new_state.fast_loop_consecutive_count == 0
    end
  end

  describe "clear_fast_loop/1" do
    test "resets tracking state" do
      state = %{
        ShapeState.new()
        | recent_requests: [{0, Offset.new(1, 0)}],
          fast_loop_consecutive_count: 3
      }

      new_state = ShapeState.clear_fast_loop(state)

      assert new_state.recent_requests == []
      assert new_state.fast_loop_consecutive_count == 0
    end
  end
end
