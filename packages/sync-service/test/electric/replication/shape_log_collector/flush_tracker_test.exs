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

      assert_raise FunctionClauseError, fn -> handle_txn(tracker, fragment, ["shape1"]) end
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

      assert_raise FunctionClauseError, fn -> handle_txn(tracker, fragment, []) end
    end
  end

  describe "handle_flush_notification/3" do
    test "should notify immediately when last shape catches up", %{tracker: tracker} do
      tracker = handle_txn(tracker, batch(lsn: 1, last_offset: 10), ["shape1"])

      _ = FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(1, 10))
      assert_receive {:flush_confirmed, 1}
    end

    test "should notify to last seen when last shape catches up", %{tracker: tracker} do
      tracker
      |> handle_txn(batch(lsn: 1, last_offset: 10), ["shape1"])
      |> handle_txn(batch(lsn: 3, last_offset: 10), [])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(1, 10))

      assert_receive {:flush_confirmed, 3}
    end

    test "should notify to one behind the minimum incomplete txn", %{tracker: tracker} do
      tracker
      |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1"])
      # Pretend we've flushed only half of this batch
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 5))

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
        |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(7, 4))
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(6, 3))

      assert_receive {:flush_confirmed, 5}

      tracker = FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(6, 10))

      assert_receive {:flush_confirmed, 6}

      FlushTracker.handle_flush_notification(tracker, "shape2", LogOffset.new(7, 10))

      assert_receive {:flush_confirmed, 7}
    end

    test "should correctly handle multiple shapes on the same incomplete position", %{
      tracker: tracker
    } do
      tracker =
        tracker
        |> handle_txn(batch(lsn: 5, last_offset: 10), ["shape1", "shape2"])
        |> handle_txn(batch(lsn: 6, last_offset: 10), ["shape1", "shape2"])
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 10))

      assert_receive {:flush_confirmed, 3}

      tracker = tracker |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(5, 10))
      assert_receive {:flush_confirmed, 4}
      refute_receive {:flush_confirmed, _}

      tracker = tracker |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(6, 3))
      refute_receive {:flush_confirmed, _}

      tracker = tracker |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(6, 3))
      assert_receive {:flush_confirmed, 5}

      tracker = tracker |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(6, 10))
      refute_receive {:flush_confirmed, _}

      FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(6, 10))
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
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(10, 10))

      assert_receive {:flush_confirmed, 10}

      tracker =
        tracker
        |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(12, 10))

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
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(10, 10))
      |> handle_txn(batch(lsn: 12, last_offset: 10), ["shape1"])
      |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(11, 10))
      |> handle_txn(batch(lsn: 13, last_offset: 10), ["shape2"])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(12, 10))

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
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(5, 10))

      assert_receive {:flush_confirmed, 3}

      # dead_shape never flushes. A new txn at lsn 6 affects only alive_shape.
      tracker = handle_txn(tracker, batch(lsn: 6, last_offset: 10), ["alive_shape"])

      # alive_shape flushes again
      tracker =
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(6, 10))

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
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(5, 10))

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
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(5, 10))

      # First flush notification: dead_shape_1 is stuck at prev_log_offset tx_offset=4
      assert_receive {:flush_confirmed, 3}

      tracker =
        FlushTracker.handle_flush_notification(tracker, "alive_shape", LogOffset.new(6, 10))

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

  describe "out-of-band consumer death leaves stale FlushTracker entry" do
    test "shape tracked across many transactions never advances global offset", %{
      tracker: tracker
    } do
      # Simulate: two shapes receive txn at lsn 10. One shape's consumer dies
      # out-of-band (no handle_shape_removed ever called). Subsequent txns only
      # affect the alive shape. The dead shape's entry pins the global offset.
      tracker = handle_txn(tracker, batch(lsn: 10, last_offset: 10), ["alive", "dead"])

      # alive flushes lsn 10
      tracker = FlushTracker.handle_flush_notification(tracker, "alive", LogOffset.new(10, 10))
      # Global offset is pinned one below dead's initial position (tx_offset=9)
      assert_receive {:flush_confirmed, 8}

      # Many subsequent transactions only affect the alive shape
      tracker =
        Enum.reduce(11..20, tracker, fn lsn, tracker ->
          tracker
          |> handle_txn(batch(lsn: lsn, last_offset: 10), ["alive"])
          |> FlushTracker.handle_flush_notification("alive", LogOffset.new(lsn, 10))
        end)

      # Despite 10 more transactions fully flushed by the alive shape,
      # global offset has not moved past the dead shape's stuck position
      refute_receive {:flush_confirmed, 10}
      refute FlushTracker.empty?(tracker)
    end

    test "removing the stale shape after prolonged stall unblocks to latest seen offset", %{
      tracker: tracker
    } do
      # Same setup: dead shape pins the offset
      tracker = handle_txn(tracker, batch(lsn: 10, last_offset: 10), ["alive", "dead"])

      tracker = FlushTracker.handle_flush_notification(tracker, "alive", LogOffset.new(10, 10))
      assert_receive {:flush_confirmed, 8}

      # More txns flow through alive shape only
      tracker =
        Enum.reduce(11..15, tracker, fn lsn, tracker ->
          tracker
          |> handle_txn(batch(lsn: lsn, last_offset: 10), ["alive"])
          |> FlushTracker.handle_flush_notification("alive", LogOffset.new(lsn, 10))
        end)

      # Now simulate detection of the dead consumer (e.g. a sweep or monitor)
      tracker = FlushTracker.handle_shape_removed(tracker, "dead")

      # Global offset jumps all the way to the latest seen offset (lsn 15)
      assert_receive {:flush_confirmed, 15}
      assert FlushTracker.empty?(tracker)
    end

    test "stale shape blocks advancement even when its tracked offset is much older than current",
         %{tracker: tracker} do
      # Dead shape gets tracked at a very early offset
      tracker = handle_txn(tracker, batch(lsn: 1, last_offset: 10), ["dead"])

      # Alive shape joins later and processes many transactions
      tracker =
        Enum.reduce(2..50, tracker, fn lsn, tracker ->
          tracker
          |> handle_txn(batch(lsn: lsn, last_offset: 10), ["alive"])
          |> FlushTracker.handle_flush_notification("alive", LogOffset.new(lsn, 10))
        end)

      # The global offset is still stuck at lsn 1's prev_log_offset position
      # because the dead shape was never removed
      refute_receive {:flush_confirmed, 2}
      refute FlushTracker.empty?(tracker)

      # Clean it up
      _tracker = FlushTracker.handle_shape_removed(tracker, "dead")
      assert_receive {:flush_confirmed, 50}
    end
  end

  # Helper: calls handle_txn_fragment with shapes_with_changes defaulting to
  # all affected shapes (the common case for single-fragment transactions).
  defp handle_txn(tracker, fragment, affected_shapes) do
    FlushTracker.handle_txn_fragment(tracker, fragment, affected_shapes)
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
