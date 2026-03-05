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

  describe "add_waiting/4" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "adds a single move-in with nil snapshot", %{state: state} do
      moved_values = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values)

      assert Map.has_key?(state.waiting_move_ins, "move1")
      assert state.waiting_move_ins["move1"] == {nil, moved_values}
    end

    @tag :move_in
    test "adds multiple move-ins", %{state: state} do
      moved_values1 = {[], MapSet.new()}
      moved_values2 = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values1)
        |> MoveIns.add_waiting("move2", moved_values2)

      assert map_size(state.waiting_move_ins) == 2
      assert state.waiting_move_ins["move1"] == {nil, moved_values1}
      assert state.waiting_move_ins["move2"] == {nil, moved_values2}
    end
  end

  describe "set_snapshot/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "sets snapshot for waiting move-in", %{state: state} do
      moved_values = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values)
      snapshot = {100, 200, [150]}
      state = MoveIns.set_snapshot(state, "move1", snapshot)

      assert state.waiting_move_ins["move1"] == {snapshot, moved_values}
    end

    @tag :move_in
    test "raises on non-existent move-in", %{state: state} do
      snapshot = {100, 200, [150]}

      assert_raise KeyError, fn ->
        MoveIns.set_snapshot(state, "nonexistent", snapshot)
      end
    end
  end

  describe "change_to_filtering/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "moves from waiting to filtering and returns visibility boundary", %{state: state} do
      snapshot = {100, 200, []}
      moved_values = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values)
      state = MoveIns.set_snapshot(state, "move1", snapshot)

      key_set = MapSet.new(["key1", "key2"])
      {visibility_boundary, state} = MoveIns.change_to_filtering(state, "move1", key_set)

      assert state.waiting_move_ins == %{}
      assert [{^snapshot, ^key_set}] = state.filtering_move_ins
      # Single move-in returns its snapshot as visibility boundary
      assert visibility_boundary == snapshot
    end

    @tag :move_in
    test "keeps other waiting move-ins", %{state: state} do
      moved_values1 = {[], MapSet.new()}
      moved_values2 = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values1)
        |> MoveIns.set_snapshot("move1", {100, 200, []})
        |> MoveIns.add_waiting("move2", moved_values2)
        |> MoveIns.set_snapshot("move2", {150, 250, []})

      {_boundary, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))

      assert Map.has_key?(state.waiting_move_ins, "move2")
      refute Map.has_key?(state.waiting_move_ins, "move1")
    end

    @tag :move_in
    test "raises on unknown move-in name", %{state: state} do
      assert_raise KeyError, fn ->
        MoveIns.change_to_filtering(state, "nonexistent", MapSet.new([]))
      end
    end

    @tag :move_in
    test "returns snapshot when resolving minimum with no other waiting", %{state: state} do
      snapshot = {100, 200, []}
      moved_values = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values)
      state = MoveIns.set_snapshot(state, "move1", snapshot)

      {boundary, _state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary == snapshot
    end

    @tag :move_in
    test "returns snapshot when resolving minimum among concurrent move-ins", %{state: state} do
      snapshot1 = {100, 200, []}
      snapshot2 = {150, 300, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot1)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot2)

      # Resolve move1 (minimum)
      {boundary, _state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary == snapshot1
    end

    @tag :move_in
    test "returns nil when resolving non-minimum", %{state: state} do
      snapshot1 = {100, 200, []}
      snapshot2 = {150, 300, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot1)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot2)

      # Resolve move2 (non-minimum) - should return nil and store snapshot2
      {boundary, state} = MoveIns.change_to_filtering(state, "move2", MapSet.new([]))
      assert boundary == nil
      assert state.maximum_resolved_snapshot == snapshot2
    end

    @tag :move_in
    test "returns stored maximum when last move-in resolves", %{state: state} do
      snapshot1 = {100, 200, []}
      snapshot2 = {150, 300, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot1)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot2)

      # Resolve move2 (non-minimum) first
      {boundary1, state} = MoveIns.change_to_filtering(state, "move2", MapSet.new([]))
      assert boundary1 == nil

      # Resolve move1 (last one) - should return stored maximum (snapshot2)
      {boundary2, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary2 == snapshot2
      assert state.maximum_resolved_snapshot == nil
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
      moved_values = {[], MapSet.new()}

      state = MoveIns.add_waiting(state, "move1", moved_values)
      state = MoveIns.set_snapshot(state, "move1", {100, 200, []})
      {_boundary, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))

      # Transaction with xid=200 (at xmax boundary - should complete)
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert state.filtering_move_ins == []
    end

    @tag :move_in
    test "keeps move-ins where xid < xmax", %{state: state} do
      moved_values = {[], MapSet.new()}

      state = MoveIns.add_waiting(state, "move1", moved_values)
      state = MoveIns.set_snapshot(state, "move1", {100, 200, []})
      {_boundary, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))

      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert length(state.filtering_move_ins) == 1
    end

    @tag :move_in
    test "removes only completed move-ins from multiple", %{state: state} do
      moved_values1 = {[], MapSet.new()}
      moved_values2 = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values1)
        |> MoveIns.set_snapshot("move1", {100, 200, []})
        |> MoveIns.add_waiting("move2", moved_values2)
        |> MoveIns.set_snapshot("move2", {100, 300, []})

      {_boundary1, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))
      {_boundary2, state} = MoveIns.change_to_filtering(state, "move2", MapSet.new(["key2"]))

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
      moved_values = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values)

      state = MoveIns.gc_touch_tracker(state)

      assert state.touch_tracker == %{"key1" => 100, "key2" => 150}
    end

    @tag :move_in
    test "removes touches < min_xmin" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 50, "key2" => 100, "key3" => 150}}
      moved_values = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values)
      state = MoveIns.set_snapshot(state, "move1", {100, 200, []})

      state = MoveIns.gc_touch_tracker(state)

      assert state.touch_tracker == %{"key2" => 100, "key3" => 150}
    end

    @tag :move_in
    test "keeps touches >= min_xmin across multiple snapshots" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 50, "key2" => 100, "key3" => 150}}
      moved_values1 = {[], MapSet.new()}
      moved_values2 = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values1)
      state = MoveIns.set_snapshot(state, "move1", {100, 200, []})
      state = MoveIns.add_waiting(state, "move2", moved_values2)
      state = MoveIns.set_snapshot(state, "move2", {120, 250, []})

      state = MoveIns.gc_touch_tracker(state)

      # min_xmin = 100, so keeps keys with xid >= 100
      assert state.touch_tracker == %{"key2" => 100, "key3" => 150}
    end

    @tag :move_in
    test "handles mix of nil and real snapshots" do
      state = MoveIns.new()
      state = %{state | touch_tracker: %{"key1" => 50, "key2" => 100, "key3" => 150}}
      moved_values1 = {[], MapSet.new()}
      moved_values2 = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values1)
      state = MoveIns.add_waiting(state, "move2", moved_values2)
      state = MoveIns.set_snapshot(state, "move2", {120, 250, []})

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

  describe "visibility boundary scenarios (integration)" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "single move-in: returns its own snapshot", %{state: state} do
      snapshot = {100, 200, [150]}
      moved_values = {[], MapSet.new()}
      state = MoveIns.add_waiting(state, "move1", moved_values)
      state = MoveIns.set_snapshot(state, "move1", snapshot)

      {boundary, _state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary == snapshot
    end

    @tag :move_in
    test "two move-ins resolving in order (both minimum): both return their snapshots", %{
      state: state
    } do
      snapshot1 = {100, 200, []}
      snapshot2 = {150, 300, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot1)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot2)

      # Resolve move1 (minimum) first - returns snapshot1
      {boundary1, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary1 == snapshot1

      # Resolve move2 (last one) - returns snapshot2
      {boundary2, _state} = MoveIns.change_to_filtering(state, "move2", MapSet.new([]))
      assert boundary2 == snapshot2
    end

    @tag :move_in
    test "two move-ins resolving out of order: stores max, returns it on last", %{state: state} do
      snapshot1 = {100, 200, []}
      snapshot2 = {150, 300, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot1)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot2)

      # Resolve move2 (non-minimum) first - returns nil, stores snapshot2
      {boundary1, state} = MoveIns.change_to_filtering(state, "move2", MapSet.new([]))
      assert boundary1 == nil
      assert state.maximum_resolved_snapshot == snapshot2

      # Resolve move1 (last one) - returns stored maximum (snapshot2)
      {boundary2, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary2 == snapshot2
      assert state.maximum_resolved_snapshot == nil
    end

    @tag :move_in
    test "three move-ins resolving: 2nd, 3rd, then 1st", %{state: state} do
      snapshot1 = {100, 200, []}
      snapshot2 = {150, 300, []}
      snapshot3 = {120, 250, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot1)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot2)
        |> MoveIns.add_waiting("move3", moved_values)
        |> MoveIns.set_snapshot("move3", snapshot3)

      # Resolve move2 (largest, not minimum) - stores snapshot2
      {boundary1, state} = MoveIns.change_to_filtering(state, "move2", MapSet.new([]))
      assert boundary1 == nil
      assert state.maximum_resolved_snapshot == snapshot2

      # Resolve move3 (middle, not minimum) - keeps maximum as snapshot2
      {boundary2, state} = MoveIns.change_to_filtering(state, "move3", MapSet.new([]))
      assert boundary2 == nil
      assert state.maximum_resolved_snapshot == snapshot2

      # Resolve move1 (last one) - returns stored maximum (snapshot2)
      {boundary3, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary3 == snapshot2
      assert state.maximum_resolved_snapshot == nil
    end

    @tag :move_in
    test "equal snapshots: both treated as minimum, both return snapshot", %{state: state} do
      snapshot = {100, 200, [150]}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot)

      # Resolve move1 - returns snapshot
      {boundary1, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary1 == snapshot

      # Resolve move2 (last one) - also returns snapshot
      {boundary2, _state} = MoveIns.change_to_filtering(state, "move2", MapSet.new([]))
      assert boundary2 == snapshot
    end

    @tag :move_in
    test "complex: 4 move-ins resolving in order 4→2→3→1", %{state: state} do
      snapshot1 = {100, 200, []}
      snapshot2 = {150, 300, []}
      snapshot3 = {120, 250, []}
      snapshot4 = {200, 400, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot1)
        |> MoveIns.add_waiting("move2", moved_values)
        |> MoveIns.set_snapshot("move2", snapshot2)
        |> MoveIns.add_waiting("move3", moved_values)
        |> MoveIns.set_snapshot("move3", snapshot3)
        |> MoveIns.add_waiting("move4", moved_values)
        |> MoveIns.set_snapshot("move4", snapshot4)

      # Resolve move4 (largest, not minimum) - stores snapshot4
      {boundary1, state} = MoveIns.change_to_filtering(state, "move4", MapSet.new([]))
      assert boundary1 == nil
      assert state.maximum_resolved_snapshot == snapshot4

      # Resolve move2 (second largest, not minimum) - keeps snapshot4
      {boundary2, state} = MoveIns.change_to_filtering(state, "move2", MapSet.new([]))
      assert boundary2 == nil
      assert state.maximum_resolved_snapshot == snapshot4

      # Resolve move3 (second smallest, not minimum) - keeps snapshot4
      {boundary3, state} = MoveIns.change_to_filtering(state, "move3", MapSet.new([]))
      assert boundary3 == nil
      assert state.maximum_resolved_snapshot == snapshot4

      # Resolve move1 (last one) - returns stored maximum (snapshot4)
      {boundary4, state} = MoveIns.change_to_filtering(state, "move1", MapSet.new([]))
      assert boundary4 == snapshot4
      assert state.maximum_resolved_snapshot == nil
    end
  end

  describe "change_visible_in_unresolved_move_ins_for_values?/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    test "returns true when value is in unresolved move-in with nil snapshot", %{state: state} do
      state = MoveIns.add_waiting(state, "move1", {["$sublink", "0"], MapSet.new([1])})

      assert MoveIns.change_visible_in_unresolved_move_ins_for_values?(
               state,
               %{["$sublink", "0"] => 1},
               100
             )
    end

    test "returns true when value is in unresolved move-in with known snapshot and xid is visible",
         %{state: state} do
      state =
        MoveIns.add_waiting(state, "move1", {["$sublink", "0"], MapSet.new([1])})
        |> MoveIns.set_snapshot("move1", {150, 200, []})

      assert MoveIns.change_visible_in_unresolved_move_ins_for_values?(
               state,
               %{["$sublink", "0"] => 1},
               100
             )
    end

    test "returns false when value is in unresolved move-in with known snapshot and xid is not visible",
         %{state: state} do
      state =
        MoveIns.add_waiting(state, "move1", {["$sublink", "0"], MapSet.new([1])})
        |> MoveIns.set_snapshot("move1", {150, 200, []})

      refute MoveIns.change_visible_in_unresolved_move_ins_for_values?(
               state,
               %{["$sublink", "0"] => 1},
               300
             )
    end

    test "returns false when value is not in unresolved move-in", %{state: state} do
      state =
        MoveIns.add_waiting(state, "move1", {["$sublink", "0"], MapSet.new([1])})

      refute MoveIns.change_visible_in_unresolved_move_ins_for_values?(
               state,
               %{["$sublink", "0"] => 2},
               100
             )
    end
  end
end
