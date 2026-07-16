defmodule Electric.Replication.ShapeLogCollector.FlushTrackerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector.FlushTracker
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.Changes.Commit

  setup do
    parent = self()
    tracker = FlushTracker.new(notify_fn: fn lsn -> send(parent, {:flush_confirmed, lsn}) end)
    %{tracker: tracker}
  end

  describe "handle_txn_fragment/4" do
    test "should immediately notify flush confirmed when caught up and no shapes are affected", %{
      tracker: tracker
    } do
      _ = handle_txn(tracker, batch(lsn: 1), [])
      assert_receive {:flush_confirmed, 1}
    end

    test "should not notify if there are shapes with unconfirmed flushes", %{
      tracker: tracker
    } do
      _ = handle_txn(tracker, batch(lsn: 1), ["shape1"])
      refute_receive {:flush_confirmed, _}
    end

    test "non-commit fragment raises FunctionClauseError", %{tracker: tracker} do
      fragment = %TransactionFragment{
        xid: 1,
        lsn: 1,
        last_log_offset: LogOffset.new(1, 0),
        commit: nil
      }

      # apply/3 hides the intentionally invalid (non-commit) fragment from the type checker.
      assert_raise FunctionClauseError, fn ->
        apply(FlushTracker, :handle_txn_fragment, [tracker, fragment, ["shape1"], 0])
      end
    end

    test "non-commit fragment with no affected shapes raises FunctionClauseError", %{
      tracker: tracker
    } do
      fragment = %TransactionFragment{
        xid: 1,
        lsn: 1,
        last_log_offset: LogOffset.new(1, 0),
        commit: nil
      }

      # apply/3 hides the intentionally invalid (non-commit) fragment from the type checker.
      assert_raise FunctionClauseError, fn ->
        apply(FlushTracker, :handle_txn_fragment, [tracker, fragment, [], 0])
      end
    end

    test "returns shapes newly tracked by this call", %{tracker: tracker} do
      {tracker, newly_tracked} =
        FlushTracker.handle_txn_fragment(tracker, batch(lsn: 1, last_offset: 10), ["shape1"], 0)

      assert newly_tracked == MapSet.new(["shape1"])

      # An already-tracked shape is not reported again; a new one is
      {tracker, newly_tracked} =
        FlushTracker.handle_txn_fragment(
          tracker,
          batch(lsn: 2, last_offset: 10),
          ["shape1", "shape2"],
          0
        )

      assert newly_tracked == MapSet.new(["shape2"])

      # No affected shapes → nothing newly tracked
      {_tracker, newly_tracked} =
        FlushTracker.handle_txn_fragment(tracker, batch(lsn: 3, last_offset: 10), [], 0)

      assert newly_tracked == MapSet.new()
    end
  end

  describe "handle_flush_notification/4" do
    test "should notify immediately when last shape catches up", %{tracker: tracker} do
      tracker = handle_txn(tracker, batch(lsn: 1, last_offset: 10), ["shape1"])

      _ = FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(1, 10), 0)
      assert_receive {:flush_confirmed, 1}
    end

    test "should notify to last seen when last shape catches up", %{tracker: tracker} do
      tracker
      |> handle_txn(batch(lsn: 1, last_offset: 10), ["shape1"])
      |> handle_txn(batch(lsn: 3, last_offset: 10), [])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(1, 10), 0)

      assert_receive {:flush_confirmed, 3}
    end

    test "should notify to one behind the minimum incomplete txn", %{tracker: tracker} do
      tracker
      |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1"])
      # Pretend we've flushed only half of this batch
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 5), 0)

      assert_receive {:flush_confirmed, 4}
    end

    test "should notify to one behind the minimum incomplete txn across all shapes", %{
      tracker: tracker
    } do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1", "shape2"])
        |> handle_txn(batch(lsn: 6, last_offset: 10), ["shape1"])
        |> handle_txn(batch(lsn: 7, last_offset: 10), ["shape2"])
        |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(7, 4), 0)
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(6, 3), 0)

      assert_receive {:flush_confirmed, 5}

      tracker = FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(6, 10), 0)

      assert_receive {:flush_confirmed, 6}

      FlushTracker.handle_flush_notification(tracker, "shape2", LogOffset.new(7, 10), 0)

      assert_receive {:flush_confirmed, 7}
    end

    test "should correctly handle multiple shapes on the same incomplete position", %{
      tracker: tracker
    } do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1", "shape2"])
        |> handle_txn(batch(lsn: 6, last_offset: 10), ["shape1", "shape2"])
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 10), 0)

      assert_receive {:flush_confirmed, 3}

      tracker =
        tracker |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(5, 10), 0)

      assert_receive {:flush_confirmed, 4}
      refute_receive {:flush_confirmed, _}

      tracker =
        tracker |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(6, 3), 0)

      refute_receive {:flush_confirmed, _}

      tracker =
        tracker |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(6, 3), 0)

      assert_receive {:flush_confirmed, 5}

      tracker =
        tracker |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(6, 10), 0)

      refute_receive {:flush_confirmed, _}

      FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(6, 10), 0)
      assert_receive {:flush_confirmed, 6}
    end

    test "should correctly handle no affected shapes", %{tracker: tracker} do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 7, last_offset: 10), [])

      # No shapes in the txn fragment, last_seen_offset becomes (7, 10)
      # last_flushed is empty → caught up → notify
      assert_receive {:flush_confirmed, 7}

      tracker =
        tracker
        |> handle_txn(batch(lsn: 10, last_offset: 10), ["shape1"])
        |> handle_txn(batch(lsn: 11, last_offset: 10), [])
        |> handle_txn(batch(lsn: 12, last_offset: 10), ["shape2"])
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(10, 10), 0)

      assert_receive {:flush_confirmed, 10}

      tracker =
        tracker
        |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(12, 10), 0)

      # There's no notification for lsn=11 because by the time that txn fragment is
      # processed, flush tracker's last_flushed is non-empty: it was populated with
      # prev_log_offset=(10-1, 0) after processing the first txn fragment for shape1.

      assert_receive {:flush_confirmed, 12}

      assert FlushTracker.empty?(tracker)
    end

    test "should notify flushes under continuous updates", %{tracker: tracker} do
      tracker
      |> handle_txn(batch(lsn: 10, last_offset: 10), ["shape1"])
      |> handle_txn(batch(lsn: 11, last_offset: 10), ["shape2"])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(10, 10), 0)
      |> handle_txn(batch(lsn: 12, last_offset: 10), ["shape1"])
      |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(11, 10), 0)
      |> handle_txn(batch(lsn: 13, last_offset: 10), ["shape2"])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(12, 10), 0)

      assert_receive {:flush_confirmed, 9}
      assert_receive {:flush_confirmed, 10}
      assert_receive {:flush_confirmed, 11}
    end
  end

  describe "handle_shape_removed/2" do
    test "should notify immediately when last shape catches up", %{tracker: tracker} do
      tracker = handle_txn(tracker, batch(lsn: 1, last_offset: 10), ["shape1"])

      _ = FlushTracker.handle_shape_removed(tracker, "shape1")
      assert_receive {:flush_confirmed, 1}
    end
  end

  describe "dead consumer blocks flush advancement" do
    test "a single unflushed shape permanently blocks last_global_flushed_offset", %{
      tracker: tracker
    } do
      # Two shapes receive txn at lsn 5
      tracker =
        handle_txn(tracker, batch(lsn: 5, last_offset: 10), ["alive_shape", "dead_shape"])

      # alive_shape flushes completely — global offset advances to one behind
      # the minimum incomplete (dead_shape is stuck at prev_log_offset with tx_offset=4)
      tracker =
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(5, 10), 0)

      assert_receive {:flush_confirmed, 3}

      # dead_shape never flushes. A new txn at lsn 6 affects only alive_shape.
      tracker = handle_txn(tracker, batch(lsn: 6, last_offset: 10), ["alive_shape"])

      # alive_shape flushes again
      tracker =
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(6, 10), 0)

      # Still stuck — dead_shape holds the global offset at 3 (tx_offset 4 minus 1)
      refute_receive {:flush_confirmed, _}

      # Tracker is not empty because dead_shape is still pending
      refute FlushTracker.empty?(tracker)
    end

    test "handle_shape_removed unblocks stuck flush advancement", %{tracker: tracker} do
      # Two shapes receive txn at lsn 5
      tracker =
        handle_txn(tracker, batch(lsn: 5, last_offset: 10), ["alive_shape", "dead_shape"])

      # alive_shape flushes completely
      tracker =
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(5, 10), 0)

      assert_receive {:flush_confirmed, 3}

      # Remove dead_shape — this is the escape hatch
      tracker = FlushTracker.handle_shape_removed(tracker, "dead_shape")

      # Now fully caught up: last_seen was lsn 5, so notification is 5
      assert_receive {:flush_confirmed, 5}

      # Tracker is now empty
      assert FlushTracker.empty?(tracker)
    end

    test "multiple dead shapes at different offsets: removing earliest unblocks to next stuck point",
         %{tracker: tracker} do
      # dead_shape_1 and alive_shape participate in txn 5
      tracker =
        handle_txn(tracker, batch(lsn: 5, last_offset: 10), ["dead_shape_1", "alive_shape"])

      # dead_shape_2 and alive_shape participate in txn 6
      tracker =
        handle_txn(tracker, batch(lsn: 6, last_offset: 10), ["dead_shape_2", "alive_shape"])

      # alive_shape flushes both txns
      tracker =
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(5, 10), 0)

      # First flush notification: dead_shape_1 is stuck at prev_log_offset tx_offset=4
      assert_receive {:flush_confirmed, 3}

      tracker =
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(6, 10), 0)

      # No additional notification — global offset is still stuck at dead_shape_1's position
      refute_receive {:flush_confirmed, _}

      # Remove dead_shape_1 — advances to dead_shape_2's stuck point (tx_offset=5, minus 1 = 4)
      tracker = FlushTracker.handle_shape_removed(tracker, "dead_shape_1")
      assert_receive {:flush_confirmed, 4}

      # Remove dead_shape_2 — now fully caught up, last_seen is lsn 6
      tracker = FlushTracker.handle_shape_removed(tracker, "dead_shape_2")
      assert_receive {:flush_confirmed, 6}

      assert FlushTracker.empty?(tracker)
    end
  end

  describe "stall detection" do
    test "last_progress_at is set when a shape is first tracked", %{tracker: tracker} do
      tracker = handle_txn(tracker, batch(lsn: 5, last_offset: 10), ["shape1"], 100)

      assert FlushTracker.stalled_shapes(tracker, 201, 100) == ["shape1"]
    end

    test "stalled_shapes uses a strict comparison against grace_ms", %{tracker: tracker} do
      tracker = handle_txn(tracker, batch(lsn: 5, last_offset: 10), ["shape1"], 100)

      # Exactly grace_ms since last progress is not yet stalled
      assert FlushTracker.stalled_shapes(tracker, 200, 100) == []
      assert FlushTracker.stalled_shapes(tracker, 201, 100) == ["shape1"]
    end

    test "last_progress_at is not refreshed by subsequent txns", %{tracker: tracker} do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1"], 100)
        |> handle_txn(batch(lsn: 6, last_offset: 10), ["shape1"], 500)

      # Still measured from the first tracking at 100
      assert FlushTracker.stalled_shapes(tracker, 600, 450) == ["shape1"]
    end

    test "last_progress_at is refreshed by a partial flush notification", %{tracker: tracker} do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1"], 100)
        # Partial flush: entry stays incomplete but counts as progress
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 5), 300)

      assert FlushTracker.stalled_shapes(tracker, 400, 100) == []
      assert FlushTracker.stalled_shapes(tracker, 401, 100) == ["shape1"]
    end

    test "completed entries are never reported as stalled", %{tracker: tracker} do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1"], 100)
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 10), 150)

      assert FlushTracker.stalled_shapes(tracker, 1_000_000, 0) == []
    end

    test "touch re-arms the grace period", %{tracker: tracker} do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1"], 100)
        |> FlushTracker.touch("shape1", 500)

      assert FlushTracker.stalled_shapes(tracker, 550, 100) == []
      assert FlushTracker.stalled_shapes(tracker, 700, 100) == ["shape1"]
    end

    test "touch is a no-op for an untracked shape", %{tracker: tracker} do
      assert FlushTracker.touch(tracker, "shape1", 500) == tracker
    end

    test "only shapes past the grace period are reported", %{tracker: tracker} do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1"], 100)
        |> handle_txn(batch(lsn: 6, last_offset: 10), ["shape2"], 400)

      assert FlushTracker.stalled_shapes(tracker, 480, 100) == ["shape1"]
    end
  end

  # Helper: calls handle_txn_fragment with shapes_with_changes defaulting to
  # all affected shapes (the common case for single-fragment transactions),
  # discarding the newly-tracked shape set.
  defp handle_txn(tracker, fragment, affected_shapes, now \\ 0) do
    {tracker, _newly_tracked} =
      FlushTracker.handle_txn_fragment(tracker, fragment, affected_shapes, now)

    tracker
  end

  defp batch(opts) do
    lsn = Keyword.fetch!(opts, :lsn)

    %TransactionFragment{
      xid: Keyword.get(opts, :xid, lsn),
      lsn: lsn,
      last_log_offset: LogOffset.new(lsn, Keyword.get(opts, :last_offset, 0)),
      commit: %Commit{}
    }
  end
end
