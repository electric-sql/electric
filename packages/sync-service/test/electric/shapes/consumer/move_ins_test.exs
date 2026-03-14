defmodule Electric.Shapes.Consumer.MoveInsTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Replication.Changes.Transaction

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
      assert state.waiting_move_ins["move1"] == {nil, moved_values, 0, 0, nil}
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
      assert state.waiting_move_ins["move1"] == {nil, moved_values1, 0, 0, nil}
      assert state.waiting_move_ins["move2"] == {nil, moved_values2, 0, 1, nil}
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

      assert state.waiting_move_ins["move1"] == {snapshot, moved_values, 0, 0, nil}
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

      {visibility_boundary, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", key_set)

      assert state.waiting_move_ins == %{}

      assert [{^snapshot, ^key_set, _moved_values, _trigger_gen, _move_in_id}] =
               state.filtering_move_ins

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

      {_boundary, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))

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

      {boundary, _trigger_gen, _move_in_id, _state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

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
      {boundary, _trigger_gen, _move_in_id, _state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

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
      {boundary, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new([]))

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
      {boundary1, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new([]))

      assert boundary1 == nil

      # Resolve move1 (last one) - should return stored maximum (snapshot2)
      {boundary2, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

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

      {_boundary, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))

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

      {_boundary, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))

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

      {_boundary1, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new(["key1"]))

      {_boundary2, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new(["key2"]))

      # xid=250 completes move1 (xmax=200) but not move2 (xmax=300)
      txn = %Transaction{xid: 250, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert length(state.filtering_move_ins) == 1
      [{snapshot, key_set, _moved_values, _trigger_gen, _move_in_id}] = state.filtering_move_ins
      assert snapshot == {100, 300, []}
      assert key_set == MapSet.new(["key2"])
    end
  end

  describe "gc_transient_move_in_state/1" do
    @tag :move_in
    test "clears shadows and delegates when no move-ins are active" do
      state = MoveIns.new()

      state = %{
        state
        | shadows: %{"key1" => {100, ["mi-1"], ["tag-1"]}},
          delegates: %{"key2" => {101, ["mi-2"], ["tag-2"]}},
          move_out_generation: 3
      }

      state = MoveIns.gc_transient_move_in_state(state)

      assert state.shadows == %{}
      assert state.delegates == %{}
      assert state.move_out_generation == 0
    end

    @tag :move_in
    test "keeps transient refs while move-ins are still active" do
      state = MoveIns.new()
      moved_values = {["$sublink", "0"], MapSet.new([1])}

      state = %{
        state
        | shadows: %{"key1" => {100, ["mi-1"], ["tag-1"]}},
          delegates: %{"key2" => {101, ["mi-2"], ["tag-2"]}}
      }

      state = MoveIns.add_waiting(state, "mi-1", moved_values)
      state = MoveIns.gc_transient_move_in_state(state)

      assert state.shadows == %{"key1" => {100, ["mi-1"], ["tag-1"]}}
      assert state.delegates == %{"key2" => {101, ["mi-2"], ["tag-2"]}}
    end
  end

  describe "key_already_shadowed_for_move_in?/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    @tag :move_in
    test "returns false when key is not shadowed", %{state: state} do
      result = MoveIns.key_already_shadowed_for_move_in?(state, "key1", "mi-1")

      assert result == false
    end

    @tag :move_in
    test "returns true when the key is shadowed for that move-in", %{state: state} do
      state = %{state | shadows: %{"key1" => {50, ["mi-1"], ["tag-1"]}}}

      result = MoveIns.key_already_shadowed_for_move_in?(state, "key1", "mi-1")

      assert result == true
    end

    @tag :move_in
    test "returns false when the key is shadowed for a different move-in", %{state: state} do
      state = %{state | shadows: %{"key1" => {50, ["mi-2"], ["tag-1"]}}}

      result = MoveIns.key_already_shadowed_for_move_in?(state, "key1", "mi-1")

      assert result == false
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

      {boundary, _trigger_gen, _move_in_id, _state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

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
      {boundary1, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

      assert boundary1 == snapshot1

      # Resolve move2 (last one) - returns snapshot2
      {boundary2, _trigger_gen, _move_in_id, _state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new([]))

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
      {boundary1, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new([]))

      assert boundary1 == nil
      assert state.maximum_resolved_snapshot == snapshot2

      # Resolve move1 (last one) - returns stored maximum (snapshot2)
      {boundary2, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

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
      {boundary1, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new([]))

      assert boundary1 == nil
      assert state.maximum_resolved_snapshot == snapshot2

      # Resolve move3 (middle, not minimum) - keeps maximum as snapshot2
      {boundary2, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move3", MapSet.new([]))

      assert boundary2 == nil
      assert state.maximum_resolved_snapshot == snapshot2

      # Resolve move1 (last one) - returns stored maximum (snapshot2)
      {boundary3, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

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
      {boundary1, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

      assert boundary1 == snapshot

      # Resolve move2 (last one) - also returns snapshot
      {boundary2, _trigger_gen, _move_in_id, _state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new([]))

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
      {boundary1, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move4", MapSet.new([]))

      assert boundary1 == nil
      assert state.maximum_resolved_snapshot == snapshot4

      # Resolve move2 (second largest, not minimum) - keeps snapshot4
      {boundary2, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move2", MapSet.new([]))

      assert boundary2 == nil
      assert state.maximum_resolved_snapshot == snapshot4

      # Resolve move3 (second smallest, not minimum) - keeps snapshot4
      {boundary3, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move3", MapSet.new([]))

      assert boundary3 == nil
      assert state.maximum_resolved_snapshot == snapshot4

      # Resolve move1 (last one) - returns stored maximum (snapshot4)
      {boundary4, _trigger_gen, _move_in_id, state} =
        MoveIns.change_to_filtering(state, "move1", MapSet.new([]))

      assert boundary4 == snapshot4
      assert state.maximum_resolved_snapshot == nil
    end
  end

  describe "pop_ready_to_splice_by_lsn/2" do
    setup do
      %{state: MoveIns.new()}
    end

    @tag :move_in
    test "returns empty list when no buffered move-ins", %{state: state} do
      assert {[], ^state} = MoveIns.pop_ready_to_splice_by_lsn(state, 1000)
    end

    @tag :move_in
    test "splices buffered move-in when Lsn wal_lsn <= integer global lsn", %{state: state} do
      # This is the scenario that was broken: wal_lsn is an Lsn struct (as
      # returned by pg_current_wal_lsn()), and the global LSN from the
      # broadcast is a plain integer. Erlang term ordering makes
      # %Lsn{} <= integer always false, so the splice never triggered.
      wal_lsn = Electric.Postgres.Lsn.from_integer(500)
      snapshot = {100, 200, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot, wal_lsn)
        |> MoveIns.buffer_completed_move_in("move1", [{"key1", []}], snapshot)

      # Global LSN equal to wal_lsn — should splice
      {ready, updated_state} = MoveIns.pop_ready_to_splice_by_lsn(state, 500)

      assert [{"move1", [{"key1", []}], ^snapshot, _key_set}] = ready
      assert updated_state.buffered_move_ins == []
    end

    @tag :move_in
    test "splices when global lsn exceeds wal_lsn", %{state: state} do
      wal_lsn = Electric.Postgres.Lsn.from_integer(500)
      snapshot = {100, 200, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot, wal_lsn)
        |> MoveIns.buffer_completed_move_in("move1", [{"key1", []}], snapshot)

      {ready, _} = MoveIns.pop_ready_to_splice_by_lsn(state, 600)

      assert [{"move1", _, _, _}] = ready
    end

    @tag :move_in
    test "does not splice when global lsn is below wal_lsn", %{state: state} do
      wal_lsn = Electric.Postgres.Lsn.from_integer(500)
      snapshot = {100, 200, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot, wal_lsn)
        |> MoveIns.buffer_completed_move_in("move1", [{"key1", []}], snapshot)

      {ready, _} = MoveIns.pop_ready_to_splice_by_lsn(state, 499)

      assert ready == []
    end

    @tag :move_in
    test "splices when wal_lsn is nil (legacy/test path)", %{state: state} do
      snapshot = {100, 200, []}
      moved_values = {[], MapSet.new()}

      state =
        state
        |> MoveIns.add_waiting("move1", moved_values)
        |> MoveIns.set_snapshot("move1", snapshot)
        |> MoveIns.buffer_completed_move_in("move1", [{"key1", []}], snapshot)

      # Any global LSN should trigger splice when wal_lsn is nil
      {ready, _} = MoveIns.pop_ready_to_splice_by_lsn(state, 1)

      assert [{"move1", _, _, _}] = ready
    end
  end
end
