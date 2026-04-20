defmodule Electric.DurableStreams.BatchTrackerTest do
  use ExUnit.Case, async: true

  alias Electric.DurableStreams.BatchTracker

  describe "register/5 and in_flight_count/2" do
    test "new tracker has no in-flight batches" do
      t = BatchTracker.new()
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "registering a batch increments in-flight count" do
      t = BatchTracker.new() |> BatchTracker.register("shape_a", 0, 100, :meta0)
      assert BatchTracker.in_flight_count(t, "shape_a") == 1
    end

    test "registering multiple batches for the same shape" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 100, :m0)
        |> BatchTracker.register("shape_a", 1, 100, :m1)
        |> BatchTracker.register("shape_a", 2, 50, :m2)

      assert BatchTracker.in_flight_count(t, "shape_a") == 3
    end

    test "in-flight count is per-shape" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 100, :m0)
        |> BatchTracker.register("shape_b", 1, 100, :m1)

      assert BatchTracker.in_flight_count(t, "shape_a") == 1
      assert BatchTracker.in_flight_count(t, "shape_b") == 1
      assert BatchTracker.in_flight_count(t, "shape_c") == 0
    end
  end

  describe "ack/3 — in-order success" do
    test "ack for single batch emits single commit" do
      t = BatchTracker.new() |> BatchTracker.register("shape_a", 0, 100, :m0)
      {t, actions} = BatchTracker.ack(t, 0, :ok)

      assert actions == [{:commit, "shape_a", 100, :m0}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "in-order acks emit commits in order" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)
        |> BatchTracker.register("shape_a", 2, 30, :m2)

      {t, a1} = BatchTracker.ack(t, 0, :ok)
      {t, a2} = BatchTracker.ack(t, 1, :ok)
      {t, a3} = BatchTracker.ack(t, 2, :ok)

      assert a1 == [{:commit, "shape_a", 10, :m0}]
      assert a2 == [{:commit, "shape_a", 20, :m1}]
      assert a3 == [{:commit, "shape_a", 30, :m2}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end
  end

  describe "ack/3 — out-of-order success" do
    test "later batch acked first is buffered until earlier batches ack" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)

      {t, actions} = BatchTracker.ack(t, 1, :ok)

      assert actions == []
      assert BatchTracker.in_flight_count(t, "shape_a") == 2
    end

    test "acking the front batch releases all consecutive acked batches" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)
        |> BatchTracker.register("shape_a", 2, 30, :m2)

      {t, a1} = BatchTracker.ack(t, 2, :ok)
      {t, a2} = BatchTracker.ack(t, 1, :ok)
      {t, a3} = BatchTracker.ack(t, 0, :ok)

      assert a1 == []
      assert a2 == []

      assert a3 == [
               {:commit, "shape_a", 10, :m0},
               {:commit, "shape_a", 20, :m1},
               {:commit, "shape_a", 30, :m2}
             ]

      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "partial flush when middle batch still pending" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)
        |> BatchTracker.register("shape_a", 2, 30, :m2)

      {t, a1} = BatchTracker.ack(t, 0, :ok)
      {t, a2} = BatchTracker.ack(t, 2, :ok)

      assert a1 == [{:commit, "shape_a", 10, :m0}]
      assert a2 == []
      assert BatchTracker.in_flight_count(t, "shape_a") == 2

      {_t, a3} = BatchTracker.ack(t, 1, :ok)

      assert a3 == [
               {:commit, "shape_a", 20, :m1},
               {:commit, "shape_a", 30, :m2}
             ]
    end
  end

  describe "ack/3 — errors trigger retry" do
    test "error on only batch emits retry, no commits" do
      t = BatchTracker.new() |> BatchTracker.register("shape_a", 0, 100, :m0)

      {t, actions} = BatchTracker.ack(t, 0, {:error, :boom})

      assert actions == [{:retry, "shape_a"}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "error on front batch drops all subsequent batches for that shape" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)
        |> BatchTracker.register("shape_a", 2, 30, :m2)

      {t, actions} = BatchTracker.ack(t, 0, {:error, :boom})

      assert actions == [{:retry, "shape_a"}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "error on middle batch drops remaining batches but keeps earlier commits" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)
        |> BatchTracker.register("shape_a", 2, 30, :m2)

      {t, commit_actions} = BatchTracker.ack(t, 0, :ok)
      assert commit_actions == [{:commit, "shape_a", 10, :m0}]

      {t, error_actions} = BatchTracker.ack(t, 1, {:error, :boom})
      assert error_actions == [{:retry, "shape_a"}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "error on batch that has out-of-order acked successors still drops them" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)
        |> BatchTracker.register("shape_a", 2, 30, :m2)

      # Batch 2 acks first (buffered)
      {t, a1} = BatchTracker.ack(t, 2, :ok)
      assert a1 == []

      # Batch 0 fails — 1 and 2 should both be dropped
      {t, a2} = BatchTracker.ack(t, 0, {:error, :boom})
      assert a2 == [{:retry, "shape_a"}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "error on one shape does not affect other shapes" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :ma)
        |> BatchTracker.register("shape_b", 1, 20, :mb)

      {t, actions} = BatchTracker.ack(t, 0, {:error, :boom})

      assert actions == [{:retry, "shape_a"}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
      assert BatchTracker.in_flight_count(t, "shape_b") == 1
    end
  end

  describe "ack/3 — late acks for dropped slots" do
    test "late ack after retry is silently ignored" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)

      {t, _} = BatchTracker.ack(t, 0, {:error, :boom})

      # Late ack for slot 1 (which was dropped)
      {t, actions} = BatchTracker.ack(t, 1, :ok)
      assert actions == []
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "ack for unknown slot_id is silently ignored" do
      t = BatchTracker.new()
      {t, actions} = BatchTracker.ack(t, 999, :ok)
      assert actions == []
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "double-ack for the same slot_id is silently ignored" do
      t = BatchTracker.new() |> BatchTracker.register("shape_a", 0, 100, :m0)
      {t, _} = BatchTracker.ack(t, 0, :ok)

      {t, actions} = BatchTracker.ack(t, 0, :ok)
      assert actions == []
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end
  end

  describe "ack/3 — multi-shape with interleaved global slot_ids" do
    test "each shape flushes independently in its own send order" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :ma0)
        |> BatchTracker.register("shape_b", 1, 100, :mb0)
        |> BatchTracker.register("shape_a", 2, 20, :ma1)
        |> BatchTracker.register("shape_b", 3, 200, :mb1)

      # Ack shape_b first batch (slot 1) before shape_a's slot 0
      {t, a1} = BatchTracker.ack(t, 1, :ok)
      assert a1 == [{:commit, "shape_b", 100, :mb0}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 2
      assert BatchTracker.in_flight_count(t, "shape_b") == 1

      {t, a2} = BatchTracker.ack(t, 0, :ok)
      assert a2 == [{:commit, "shape_a", 10, :ma0}]

      # After slot 1's commit, slot 3 is at the front of shape_b — ack flushes it
      {t, a3} = BatchTracker.ack(t, 3, :ok)
      assert a3 == [{:commit, "shape_b", 200, :mb1}]
      assert BatchTracker.in_flight_count(t, "shape_b") == 0

      {t, a4} = BatchTracker.ack(t, 2, :ok)
      assert a4 == [{:commit, "shape_a", 20, :ma1}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0

      # Double-ack for slot 3 is ignored (already committed and removed)
      {_t, a5} = BatchTracker.ack(t, 3, :ok)
      assert a5 == []
    end

    test "retry on one shape, commits continue on another" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :ma0)
        |> BatchTracker.register("shape_b", 1, 20, :mb0)
        |> BatchTracker.register("shape_a", 2, 30, :ma1)

      {t, a1} = BatchTracker.ack(t, 0, {:error, :boom})
      assert a1 == [{:retry, "shape_a"}]

      {t, a2} = BatchTracker.ack(t, 1, :ok)
      assert a2 == [{:commit, "shape_b", 20, :mb0}]

      # Slot 2 (shape_a) was dropped by the retry
      {_t, a3} = BatchTracker.ack(t, 2, :ok)
      assert a3 == []
    end
  end

  describe "fail_all/2" do
    test "empty tracker returns no actions" do
      t = BatchTracker.new()
      {t, actions} = BatchTracker.fail_all(t, :connection_lost)
      assert actions == []
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "single shape with pending batches emits one retry" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)

      {t, actions} = BatchTracker.fail_all(t, :connection_lost)

      assert actions == [{:retry, "shape_a"}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "multiple shapes with pending batches each get one retry" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :ma)
        |> BatchTracker.register("shape_b", 1, 20, :mb)
        |> BatchTracker.register("shape_a", 2, 30, :ma2)

      {t, actions} = BatchTracker.fail_all(t, :connection_lost)

      assert {:retry, "shape_a"} in actions
      assert {:retry, "shape_b"} in actions
      assert length(actions) == 2
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
      assert BatchTracker.in_flight_count(t, "shape_b") == 0
    end

    test "mix of pending and out-of-order acked batches all get retried" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)
        |> BatchTracker.register("shape_a", 2, 30, :m2)

      # Batch 2 is acked out-of-order (buffered)
      {t, _} = BatchTracker.ack(t, 2, :ok)
      assert BatchTracker.in_flight_count(t, "shape_a") == 3

      {t, actions} = BatchTracker.fail_all(t, :connection_lost)

      assert actions == [{:retry, "shape_a"}]
      assert BatchTracker.in_flight_count(t, "shape_a") == 0
    end

    test "late acks after fail_all are silently ignored" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)

      {t, _} = BatchTracker.fail_all(t, :connection_lost)

      {t, a1} = BatchTracker.ack(t, 0, :ok)
      {_t, a2} = BatchTracker.ack(t, 1, {:error, :boom})

      assert a1 == []
      assert a2 == []
    end
  end

  describe "register/5 after retry" do
    test "registering a new batch after retry works normally" do
      t =
        BatchTracker.new()
        |> BatchTracker.register("shape_a", 0, 10, :m0)
        |> BatchTracker.register("shape_a", 1, 20, :m1)

      {t, _} = BatchTracker.ack(t, 0, {:error, :boom})
      assert BatchTracker.in_flight_count(t, "shape_a") == 0

      # Re-register (retry path) with new slot_ids
      t =
        t
        |> BatchTracker.register("shape_a", 2, 10, :m0b)
        |> BatchTracker.register("shape_a", 3, 20, :m1b)

      assert BatchTracker.in_flight_count(t, "shape_a") == 2

      {t, a1} = BatchTracker.ack(t, 2, :ok)
      {_t, a2} = BatchTracker.ack(t, 3, :ok)

      assert a1 == [{:commit, "shape_a", 10, :m0b}]
      assert a2 == [{:commit, "shape_a", 20, :m1b}]
    end
  end
end
