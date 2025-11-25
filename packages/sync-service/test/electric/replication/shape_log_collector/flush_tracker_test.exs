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

  describe "handle_txn_fragment/2" do
    test "should immediately notify flush confirmed when caught up and no shapes are affected", %{
      tracker: tracker
    } do
      _ = FlushTracker.handle_txn_fragment(tracker, batch(lsn: 1), [])
      assert_receive {:flush_confirmed, 1}
    end

    test "should not notify if there are flushes are unconfirmed", %{
      tracker: tracker
    } do
      _ = FlushTracker.handle_txn_fragment(tracker, batch(lsn: 1), ["shape1"])
      refute_receive {:flush_confirmed, _}, 50
    end

    test "should ignore fragments without commits", %{tracker: tracker} do
      fragment = %TransactionFragment{
        lsn: 1,
        last_log_offset: LogOffset.new(1, 0),
        commit: nil
      }

      tracker = FlushTracker.handle_txn_fragment(tracker, fragment, ["shape1"])
      refute_receive {:flush_confirmed, _}, 50
      assert FlushTracker.empty?(tracker)
    end

    test "should ignore fragments without commits and not affect subsequent tracking", %{
      tracker: tracker
    } do
      fragment_without_commit = %TransactionFragment{
        lsn: 1,
        last_log_offset: LogOffset.new(1, 0),
        commit: nil
      }

      tracker = FlushTracker.handle_txn_fragment(tracker, fragment_without_commit, ["shape1"])

      # Subsequent fragment with commit should be tracked normally
      tracker =
        FlushTracker.handle_txn_fragment(tracker, batch(lsn: 2, last_offset: 10), ["shape1"])

      # Flush notification should work for the fragment with commit
      _ = FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(2, 10))

      # Should only receive flush for lsn 2, not lsn 1
      assert_receive {:flush_confirmed, 2}
      refute_receive {:flush_confirmed, _}, 50
    end
  end

  describe "handle_flush_notification/3" do
    test "should notify immediately when last shape catches up", %{tracker: tracker} do
      tracker =
        FlushTracker.handle_txn_fragment(tracker, batch(lsn: 1, last_offset: 10), ["shape1"])

      _ = FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(1, 10))
      assert_receive {:flush_confirmed, 1}
    end

    test "should notify to last seen when last shape catches up", %{tracker: tracker} do
      tracker
      |> FlushTracker.handle_txn_fragment(batch(lsn: 1, last_offset: 10), ["shape1"])
      |> FlushTracker.handle_txn_fragment(batch(lsn: 3, last_offset: 10), [])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(1, 10))

      assert_receive {:flush_confirmed, 3}
    end

    test "should notify to one behind the minimum incomplete txn", %{tracker: tracker} do
      tracker
      |> FlushTracker.handle_txn_fragment(batch(lsn: 5, last_offset: 10), ["shape1"])
      # Pretend we've flushed only half of this batch
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 5))

      assert_receive {:flush_confirmed, 4}
    end

    test "should notify to one behind the minimum incomplete txn across all shapes", %{
      tracker: tracker
    } do
      tracker =
        tracker
        |> FlushTracker.handle_txn_fragment(batch(lsn: 5, last_offset: 10), ["shape1", "shape2"])
        |> FlushTracker.handle_txn_fragment(batch(lsn: 6, last_offset: 10), ["shape1"])
        |> FlushTracker.handle_txn_fragment(batch(lsn: 7, last_offset: 10), ["shape2"])
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
        |> FlushTracker.handle_txn_fragment(batch(lsn: 5, last_offset: 10), ["shape1", "shape2"])
        |> FlushTracker.handle_txn_fragment(batch(lsn: 6, last_offset: 10), ["shape1", "shape2"])
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(5, 10))
        |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(5, 10))

      assert_receive {:flush_confirmed, 3}
      assert_receive {:flush_confirmed, 4}
      refute_receive {:flush_confirmed, _}, 50

      FlushTracker.handle_flush_notification(tracker, "shape1", LogOffset.new(6, 3))

      refute_receive {:flush_confirmed, _}, 50
    end

    test "should correctly handle no affected shapes", %{tracker: tracker} do
      tracker =
        tracker
        |> FlushTracker.handle_txn_fragment(batch(lsn: 7, last_offset: 10), [])
        |> FlushTracker.handle_txn_fragment(batch(lsn: 10, last_offset: 10), ["shape1"])
        |> FlushTracker.handle_txn_fragment(batch(lsn: 11, last_offset: 10), [])
        |> FlushTracker.handle_txn_fragment(batch(lsn: 12, last_offset: 10), ["shape2"])
        |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(10, 10))
        |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(12, 10))

      assert_receive {:flush_confirmed, 7}
      assert_receive {:flush_confirmed, 12}

      assert FlushTracker.empty?(tracker)
    end

    test "should notify flushes under continuous updates", %{tracker: tracker} do
      tracker
      |> FlushTracker.handle_txn_fragment(batch(lsn: 10, last_offset: 10), ["shape1"])
      |> FlushTracker.handle_txn_fragment(batch(lsn: 11, last_offset: 10), ["shape2"])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(10, 10))
      |> FlushTracker.handle_txn_fragment(batch(lsn: 12, last_offset: 10), ["shape1"])
      |> FlushTracker.handle_flush_notification("shape2", LogOffset.new(11, 10))
      |> FlushTracker.handle_txn_fragment(batch(lsn: 13, last_offset: 10), ["shape2"])
      |> FlushTracker.handle_flush_notification("shape1", LogOffset.new(12, 10))

      assert_receive {:flush_confirmed, 9}
      assert_receive {:flush_confirmed, 10}
      assert_receive {:flush_confirmed, 11}
    end
  end

  describe "handle_shape_removed/2" do
    test "should notify immediately when last shape catches up", %{tracker: tracker} do
      tracker =
        FlushTracker.handle_txn_fragment(tracker, batch(lsn: 1, last_offset: 10), ["shape1"])

      _ = FlushTracker.handle_shape_removed(tracker, "shape1")
      assert_receive {:flush_confirmed, 1}
    end
  end

  defp batch(opts) do
    lsn = Keyword.fetch!(opts, :lsn)

    %TransactionFragment{
      lsn: lsn,
      last_log_offset: LogOffset.new(lsn, Keyword.get(opts, :last_offset, 0)),
      commit: %Commit{}
    }
  end
end
