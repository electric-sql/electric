defmodule Electric.Shapes.Consumer.MoveInsTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes

  describe "new/0" do
    test "creates empty state" do
      state = MoveIns.new()

      assert state.waiting_move_ins == %{}
      assert state.filtering_move_ins == []
    end
  end

  describe "add_waiting/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "adds a single move-in", %{state: state} do
      snapshot = {100, 200, [150]}
      state = MoveIns.add_waiting(state, "move1", snapshot)

      assert Map.has_key?(state.waiting_move_ins, "move1")
      assert state.waiting_move_ins["move1"] == snapshot
    end

    @tag :move_in
    test "adds move-in with nil snapshot initially", %{state: state} do
      state = MoveIns.add_waiting(state, "move1", nil)

      assert Map.has_key?(state.waiting_move_ins, "move1")
      assert state.waiting_move_ins["move1"] == nil
    end

    @tag :move_in
    test "adds multiple move-ins", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, [150]})
        |> MoveIns.add_waiting("move2", {50, 250, [175]})

      assert map_size(state.waiting_move_ins) == 2
      assert state.waiting_move_ins["move1"] == {100, 200, [150]}
      assert state.waiting_move_ins["move2"] == {50, 250, [175]}
    end
  end

  describe "set_snapshot/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "sets snapshot for waiting move-in", %{state: state} do
      state = MoveIns.add_waiting(state, "move1", nil)
      snapshot = {100, 200, [150]}
      state = MoveIns.set_snapshot(state, "move1", snapshot)

      assert state.waiting_move_ins["move1"] == snapshot
    end

    @tag :move_in
    test "adds move-in if it doesn't exist", %{state: state} do
      snapshot = {100, 200, [150]}
      state = MoveIns.set_snapshot(state, "nonexistent", snapshot)

      assert state.waiting_move_ins == %{"nonexistent" => snapshot}
    end
  end

  describe "change_to_filtering/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "moves from waiting to filtering", %{state: state} do
      snapshot = {100, 200, []}
      state = MoveIns.add_waiting(state, "move1", snapshot)

      key_set = MapSet.new(["key1", "key2"])
      state = MoveIns.change_to_filtering(state, "move1", key_set)

      assert state.waiting_move_ins == %{}
      assert [{^snapshot, ^key_set}] = state.filtering_move_ins
    end

    @tag :move_in
    test "keeps other waiting move-ins", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.add_waiting("move2", {150, 250, []})
        |> MoveIns.change_to_filtering("move1", MapSet.new(["key1"]))

      assert Map.has_key?(state.waiting_move_ins, "move2")
      refute Map.has_key?(state.waiting_move_ins, "move1")
    end

    @tag :move_in
    test "raises on unknown move-in name", %{state: state} do
      assert_raise KeyError, fn ->
        MoveIns.change_to_filtering(state, "nonexistent", MapSet.new([]))
      end
    end
  end

  describe "remove_completed/2" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "removes move-ins where xid >= xmax", %{state: state} do
      # Move-in with xmax=200
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.change_to_filtering("move1", MapSet.new(["key1"]))

      # Transaction with xid=200 (at xmax boundary - should complete)
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert state.filtering_move_ins == []
    end

    @tag :move_in
    test "keeps move-ins where xid < xmax", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.change_to_filtering("move1", MapSet.new(["key1"]))

      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert length(state.filtering_move_ins) == 1
    end

    @tag :move_in
    test "removes only completed move-ins from multiple", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.add_waiting("move2", {100, 300, []})
        |> MoveIns.change_to_filtering("move1", MapSet.new(["key1"]))
        |> MoveIns.change_to_filtering("move2", MapSet.new(["key2"]))

      # xid=250 completes move1 (xmax=200) but not move2 (xmax=300)
      txn = %Transaction{xid: 250, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert length(state.filtering_move_ins) == 1
      [{snapshot, key_set}] = state.filtering_move_ins
      assert snapshot == {100, 300, []}
      assert key_set == MapSet.new(["key2"])
    end
  end

  describe "track_touch/3" do
    @tag :move_in
    test "tracks INSERT operations" do
      state = MoveIns.new()
      change = %Changes.NewRecord{key: "key1", record: %{}}

      state = MoveIns.track_touch(state, 100, change)

      assert state.touch_tracker == %{"key1" => 100}
    end

    @tag :move_in
    test "tracks UPDATE operations" do
      state = MoveIns.new()
      change = %Changes.UpdatedRecord{key: "key1", record: %{}, old_record: %{}}

      state = MoveIns.track_touch(state, 100, change)

      assert state.touch_tracker == %{"key1" => 100}
    end

    @tag :move_in
    test "does NOT track DELETE operations" do
      state = MoveIns.new()
      change = %Changes.DeletedRecord{key: "key1", old_record: %{}}

      state = MoveIns.track_touch(state, 100, change)

      assert state.touch_tracker == %{}
    end

    @tag :move_in
    test "updates existing key with newer xid" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 100}}
      change = %Changes.NewRecord{key: "key1", record: %{}}

      state = MoveIns.track_touch(state, 150, change)

      assert state.touch_tracker == %{"key1" => 150}
    end
  end

  describe "gc_touch_tracker/1" do
    @tag :move_in
    test "clears all when no pending queries" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 100, "key2" => 150}}

      state = MoveIns.gc_touch_tracker(state)

      assert state.touch_tracker == %{}
    end

    @tag :move_in
    test "keeps all touches when no snapshots known yet" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 100, "key2" => 150}}
      state = MoveIns.add_waiting(state, "move1", nil)

      state = MoveIns.gc_touch_tracker(state)

      assert state.touch_tracker == %{"key1" => 100, "key2" => 150}
    end

    @tag :move_in
    test "removes touches < min_xmin" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 50, "key2" => 100, "key3" => 150}}
      state = MoveIns.add_waiting(state, "move1", {100, 200, []})

      state = MoveIns.gc_touch_tracker(state)

      assert state.touch_tracker == %{"key2" => 100, "key3" => 150}
    end

    @tag :move_in
    test "keeps touches >= min_xmin across multiple snapshots" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 50, "key2" => 100, "key3" => 150}}
      state = MoveIns.add_waiting(state, "move1", {100, 200, []})
      state = MoveIns.add_waiting(state, "move2", {120, 250, []})

      state = MoveIns.gc_touch_tracker(state)

      # min_xmin = 100, so keeps keys with xid >= 100
      assert state.touch_tracker == %{"key2" => 100, "key3" => 150}
    end

    @tag :move_in
    test "handles mix of nil and real snapshots" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 50, "key2" => 100, "key3" => 150}}
      state = MoveIns.add_waiting(state, "move1", nil)
      state = MoveIns.add_waiting(state, "move2", {120, 250, []})

      state = MoveIns.gc_touch_tracker(state)

      # min_xmin = 120, so only keeps key3
      assert state.touch_tracker == %{"key3" => 150}
    end
  end

  describe "should_skip_query_row?/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "returns false when key not in tracker", %{state: state} do
      snapshot = {100, 200, []}

      result = MoveIns.should_skip_query_row?(state.touch_tracker, snapshot, "key1")

      assert result == false
    end

    @tag :move_in
    test "returns false when touch is visible in snapshot", %{state: state} do
      state = %{state | touch_tracker: %{"key1" => 50}}
      snapshot = {100, 200, []}

      result = MoveIns.should_skip_query_row?(state.touch_tracker, snapshot, "key1")

      # xid=50 < xmin=100, so visible
      assert result == false
    end

    @tag :move_in
    test "returns true when touch xid >= xmax", %{state: state} do
      state = %{state | touch_tracker: %{"key1" => 250}}
      snapshot = {100, 200, []}

      result = MoveIns.should_skip_query_row?(state.touch_tracker, snapshot, "key1")

      # xid=250 >= xmax=200, so not visible (happened after snapshot)
      assert result == true
    end

    @tag :move_in
    test "returns true when touch xid in xip_list", %{state: state} do
      state = %{state | touch_tracker: %{"key1" => 150}}
      snapshot = {100, 200, [150]}

      result = MoveIns.should_skip_query_row?(state.touch_tracker, snapshot, "key1")

      # xid=150 is in xip_list, so not visible (not committed at snapshot time)
      assert result == true
    end
  end
end
