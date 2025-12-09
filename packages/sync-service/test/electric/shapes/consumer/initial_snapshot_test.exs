defmodule Electric.Shapes.Consumer.InitialSnapshotTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.InitialSnapshot
  alias Electric.Replication.Changes.Transaction
  alias Electric.ShapeCache.Storage

  import Support.ComponentSetup

  @moduletag :tmp_dir

  describe "new/1" do
    test "creates state with no snapshot" do
      state = InitialSnapshot.new(nil)

      assert state.filtering? == true
      assert state.snapshot_started? == false
      assert state.pg_snapshot == nil
      assert state.awaiting_snapshot_start == []
    end

    test "creates state with snapshot map" do
      snapshot = %{xmin: 100, xmax: 200, xip_list: [150], filter_txns?: true}
      state = InitialSnapshot.new(snapshot)

      assert state.filtering? == true
      assert state.snapshot_started? == false
      assert state.pg_snapshot == {100, 200, [150]}
      assert state.awaiting_snapshot_start == []
    end

    test "respects filter_txns? flag from snapshot" do
      snapshot = %{xmin: 100, xmax: 200, xip_list: [], filter_txns?: false}
      state = InitialSnapshot.new(snapshot)

      assert state.filtering? == false
      assert state.pg_snapshot == {100, 200, []}
    end

    test "defaults filter_txns? to true if not present" do
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}
      state = InitialSnapshot.new(snapshot)

      assert state.filtering? == true
    end
  end

  describe "add_waiter/2" do
    test "adds waiter to empty list" do
      state = InitialSnapshot.new(nil)
      from = {self(), make_ref()}

      state = InitialSnapshot.add_waiter(state, from)

      assert state.awaiting_snapshot_start == [from]
    end

    test "adds multiple waiters" do
      state = InitialSnapshot.new(nil)
      from1 = {self(), make_ref()}
      from2 = {self(), make_ref()}

      state =
        state
        |> InitialSnapshot.add_waiter(from1)
        |> InitialSnapshot.add_waiter(from2)

      assert state.awaiting_snapshot_start == [from2, from1]
    end
  end

  describe "reply_to_waiters/2" do
    test "replies to all waiters and clears list" do
      parent = self()
      ref1 = make_ref()
      ref2 = make_ref()

      state =
        InitialSnapshot.new(nil)
        |> InitialSnapshot.add_waiter({parent, ref1})
        |> InitialSnapshot.add_waiter({parent, ref2})

      state = InitialSnapshot.reply_to_waiters(state, :started)

      assert state.awaiting_snapshot_start == []
      assert_received {^ref1, :started}
      assert_received {^ref2, :started}
    end

    test "handles empty waiter list" do
      state = InitialSnapshot.new(nil)

      state = InitialSnapshot.reply_to_waiters(state, :started)

      assert state.awaiting_snapshot_start == []
    end

    test "handles nil waiters in list" do
      parent = self()
      ref = make_ref()

      state = %{InitialSnapshot.new(nil) | awaiting_snapshot_start: [nil, {parent, ref}]}

      state = InitialSnapshot.reply_to_waiters(state, :started)

      assert state.awaiting_snapshot_start == []
      assert_received {^ref, :started}
    end
  end

  describe "needs_buffering?/1" do
    test "returns true when snapshot is nil" do
      state = InitialSnapshot.new(nil)

      assert InitialSnapshot.needs_buffering?(state) == true
    end

    test "returns false when snapshot is set" do
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}
      state = InitialSnapshot.new(snapshot)

      assert InitialSnapshot.needs_buffering?(state) == false
    end
  end

  describe "set_initial_snapshot/3" do
    setup [:with_stack_id_from_test, :with_in_memory_storage]

    setup %{storage: storage} do
      shape_storage = Storage.for_shape("test-handle", storage)
      Storage.start_link(shape_storage)
      %{shape_storage: shape_storage}
    end

    test "sets snapshot and updates storage", %{shape_storage: storage} do
      state = InitialSnapshot.new(nil)
      snapshot = {100, 200, [150]}

      state = InitialSnapshot.set_initial_snapshot(state, storage, snapshot)

      assert state.pg_snapshot == snapshot
      assert state.filtering? == true

      # Verify storage was updated
      {:ok, stored_snapshot} = Storage.get_pg_snapshot(storage)
      assert stored_snapshot == %{xmin: 100, xmax: 200, xip_list: [150], filter_txns?: true}
    end

    test "sets snapshot with empty xip_list", %{shape_storage: storage} do
      state = InitialSnapshot.new(nil)
      snapshot = {100, 200, []}

      state = InitialSnapshot.set_initial_snapshot(state, storage, snapshot)

      assert state.pg_snapshot == snapshot
      assert state.filtering? == true

      # Verify storage was updated
      {:ok, stored_snapshot} = Storage.get_pg_snapshot(storage)
      assert stored_snapshot == %{xmin: 100, xmax: 200, xip_list: [], filter_txns?: true}
    end
  end

  describe "mark_snapshot_started/2" do
    setup [:with_stack_id_from_test, :with_in_memory_storage]

    setup %{storage: storage} do
      shape_storage = Storage.for_shape("test-handle", storage)
      Storage.start_link(shape_storage)
      %{shape_storage: shape_storage}
    end

    test "marks snapshot as started and replies to waiters", %{shape_storage: storage} do
      parent = self()
      ref = make_ref()

      state =
        InitialSnapshot.new(nil)
        |> InitialSnapshot.add_waiter({parent, ref})

      state = InitialSnapshot.mark_snapshot_started(state, storage)

      assert state.snapshot_started? == true
      assert state.awaiting_snapshot_start == []
      assert_received {^ref, :started}

      # Verify storage was updated
      assert Storage.snapshot_started?(storage)
    end

    test "is idempotent when already started", %{shape_storage: storage} do
      state = InitialSnapshot.new(nil)

      state = InitialSnapshot.mark_snapshot_started(state, storage)
      assert state.snapshot_started? == true

      # Call again
      state = InitialSnapshot.mark_snapshot_started(state, storage)
      assert state.snapshot_started? == true
    end
  end

  describe "maybe_stop_initial_filtering/3" do
    setup [:with_stack_id_from_test, :with_in_memory_storage]

    setup %{storage: storage} do
      shape_storage = Storage.for_shape("test-handle", storage)
      Storage.start_link(shape_storage)
      %{shape_storage: shape_storage}
    end

    test "stops filtering when transaction is after snapshot", %{shape_storage: storage} do
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}
      state = InitialSnapshot.new(snapshot)

      # Transaction with xid >= xmax should stop filtering
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      state = InitialSnapshot.maybe_stop_initial_filtering(state, storage, txn)

      assert state.filtering? == false

      # Verify storage was updated
      {:ok, stored_snapshot} = Storage.get_pg_snapshot(storage)
      assert stored_snapshot.filter_txns? == false
    end

    test "keeps filtering when transaction is within snapshot", %{shape_storage: storage} do
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}
      state = InitialSnapshot.new(snapshot)

      # Transaction with xid < xmax should keep filtering
      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      state = InitialSnapshot.maybe_stop_initial_filtering(state, storage, txn)

      assert state.filtering? == true
    end

    test "stops filtering when transaction xid is in xip_list but after xmax", %{
      shape_storage: storage
    } do
      snapshot = %{xmin: 100, xmax: 200, xip_list: [150]}
      state = InitialSnapshot.new(snapshot)

      # Transaction with xid >= xmax
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      state = InitialSnapshot.maybe_stop_initial_filtering(state, storage, txn)

      assert state.filtering? == false
    end
  end

  describe "filter/3" do
    setup [:with_stack_id_from_test, :with_in_memory_storage]

    setup %{storage: storage} do
      shape_storage = Storage.for_shape("test-handle", storage)
      Storage.start_link(shape_storage)
      %{shape_storage: shape_storage}
    end

    test "returns :consider_flushed for transactions visible in snapshot", %{
      shape_storage: storage
    } do
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}
      state = InitialSnapshot.new(snapshot)

      # Transaction with xid < xmax and not in xip_list is visible
      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      {result, state} = InitialSnapshot.filter(state, storage, txn)

      assert result == :consider_flushed
      assert state.filtering? == true
    end

    test "returns :continue and stops filtering for transactions after snapshot", %{
      shape_storage: storage
    } do
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}
      state = InitialSnapshot.new(snapshot)

      # Transaction with xid >= xmax is not visible
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      {result, state} = InitialSnapshot.filter(state, storage, txn)

      assert result == :continue
      assert state.filtering? == false
    end

    test "returns :consider_flushed for transactions in xip_list", %{shape_storage: storage} do
      snapshot = %{xmin: 100, xmax: 200, xip_list: [150]}
      state = InitialSnapshot.new(snapshot)

      # Transaction with xid in xip_list is not visible, but still within snapshot range
      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      {result, _state} = InitialSnapshot.filter(state, storage, txn)

      # Transactions in xip_list are considered in-progress at snapshot time,
      # so they're not visible in the snapshot
      assert result == :continue
    end

    test "returns :consider_flushed for transactions before xmin", %{shape_storage: storage} do
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}
      state = InitialSnapshot.new(snapshot)

      # Transaction with xid < xmin is visible (committed before snapshot)
      txn = %Transaction{xid: 50, lsn: {0, 1}, changes: []}
      {result, state} = InitialSnapshot.filter(state, storage, txn)

      assert result == :consider_flushed
      assert state.filtering? == true
    end
  end
end
