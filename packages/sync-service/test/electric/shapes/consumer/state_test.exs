defmodule Electric.Shapes.Consumer.StateTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.State
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.Transaction

  import Support.ComponentSetup

  @moduletag :tmp_dir

  describe "new/3" do
    setup [:with_stack_id_from_test]

    test "creates uninitialized state", %{stack_id: stack_id} do
      shape = %Electric.Shapes.Shape{root_table: {"public", "items"}, root_table_id: 1}
      state = State.new(stack_id, "test-handle", shape)

      assert state.stack_id == stack_id
      assert state.shape_handle == "test-handle"
      assert state.shape == shape
      assert state.buffering? == true
      assert state.latest_offset == nil
      assert state.initial_pg_snapshot == nil
      assert state.storage == nil
      assert state.writer == nil
    end
  end

  describe "add_waiting_move_in/3" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape = %Electric.Shapes.Shape{root_table: {"public", "items"}, root_table_id: 1}
      state = State.new(stack_id, "test-handle", shape)
      %{state: state}
    end

    test "adds a single move-in and creates buffering snapshot", %{state: state} do
      snapshot = {100, 200, [150]}
      state = State.add_waiting_move_in(state, "move1", snapshot)

      assert Map.has_key?(state.waiting_move_ins, "move1")
      assert state.waiting_move_ins["move1"] == snapshot
      assert state.move_in_buffering_snapshot == {100, 200, [150]}
    end

    test "combines multiple move-ins into union buffering snapshot", %{state: state} do
      state =
        state
        |> State.add_waiting_move_in("move1", {100, 200, [150]})
        |> State.add_waiting_move_in("move2", {50, 250, [175]})

      assert map_size(state.waiting_move_ins) == 2

      # Union should have min(xmin), max(xmax), combined xip_list
      {xmin, xmax, xip_list} = state.move_in_buffering_snapshot
      assert xmin == 50
      assert xmax == 250
      assert Enum.sort(xip_list) == [150, 175]
    end

    test "handles overlapping xip_lists", %{state: state} do
      state =
        state
        |> State.add_waiting_move_in("move1", {100, 200, [150, 160]})
        |> State.add_waiting_move_in("move2", {90, 210, [160, 170]})

      {_xmin, _xmax, xip_list} = state.move_in_buffering_snapshot
      # Combined list has duplicates (that's fine for the visibility check)
      assert length(xip_list) == 4
    end
  end

  describe "change_move_in_to_filtering/3" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape = %Electric.Shapes.Shape{root_table: {"public", "items"}, root_table_id: 1}
      state = State.new(stack_id, "test-handle", shape)
      %{state: state}
    end

    test "moves from waiting to filtering", %{state: state} do
      snapshot = {100, 200, []}
      state = State.add_waiting_move_in(state, "move1", snapshot)

      key_set = ["key1", "key2"]
      state = State.change_move_in_to_filtering(state, "move1", key_set)

      assert state.waiting_move_ins == %{}
      assert [{^snapshot, ^key_set}] = state.filtering_move_ins
      assert state.move_in_buffering_snapshot == nil
    end

    test "keeps other waiting move-ins", %{state: state} do
      state =
        state
        |> State.add_waiting_move_in("move1", {100, 200, []})
        |> State.add_waiting_move_in("move2", {150, 250, []})
        |> State.change_move_in_to_filtering("move1", ["key1"])

      assert Map.has_key?(state.waiting_move_ins, "move2")
      refute Map.has_key?(state.waiting_move_ins, "move1")
      assert state.move_in_buffering_snapshot == {150, 250, []}
    end

    test "raises on unknown move-in name", %{state: state} do
      assert_raise KeyError, fn ->
        State.change_move_in_to_filtering(state, "nonexistent", [])
      end
    end
  end

  describe "remove_completed_move_ins/2" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape = %Electric.Shapes.Shape{root_table: {"public", "items"}, root_table_id: 1}
      state = State.new(stack_id, "test-handle", shape)
      %{state: state}
    end

    test "removes move-ins where xid >= xmax", %{state: state} do
      # Move-in with xmax=200
      state =
        state
        |> State.add_waiting_move_in("move1", {100, 200, []})
        |> State.change_move_in_to_filtering("move1", ["key1"])

      # Transaction with xid=200 (at xmax boundary - should complete)
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      state = State.remove_completed_move_ins(state, txn)

      assert state.filtering_move_ins == []
    end

    test "keeps move-ins where xid < xmax", %{state: state} do
      state =
        state
        |> State.add_waiting_move_in("move1", {100, 200, []})
        |> State.change_move_in_to_filtering("move1", ["key1"])

      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      state = State.remove_completed_move_ins(state, txn)

      assert length(state.filtering_move_ins) == 1
    end

    test "removes only completed move-ins from multiple", %{state: state} do
      state =
        state
        |> State.add_waiting_move_in("move1", {100, 200, []})
        |> State.add_waiting_move_in("move2", {100, 300, []})
        |> State.change_move_in_to_filtering("move1", ["key1"])
        |> State.change_move_in_to_filtering("move2", ["key2"])

      # xid=250 completes move1 (xmax=200) but not move2 (xmax=300)
      txn = %Transaction{xid: 250, lsn: {0, 1}, changes: []}
      state = State.remove_completed_move_ins(state, txn)

      assert length(state.filtering_move_ins) == 1
      assert [{{100, 300, []}, ["key2"]}] = state.filtering_move_ins
    end
  end

  describe "align_offset_to_txn_boundary/2" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape = %Electric.Shapes.Shape{root_table: {"public", "items"}, root_table_id: 1}
      state = State.new(stack_id, "test-handle", shape)
      %{state: state}
    end

    test "returns boundary for exact match", %{state: state} do
      offset1 = LogOffset.new(100, 5)
      boundary1 = LogOffset.new(100, 10)
      offset2 = LogOffset.new(200, 3)
      boundary2 = LogOffset.new(200, 8)

      state = %{state | txn_offset_mapping: [{offset1, boundary1}, {offset2, boundary2}]}

      {state, result} = State.align_offset_to_txn_boundary(state, offset1)
      assert result == boundary1
      # Should remove the matched entry
      assert state.txn_offset_mapping == [{offset2, boundary2}]
    end

    test "returns original offset when no match and cleans up earlier entries", %{state: state} do
      offset1 = LogOffset.new(100, 5)
      boundary1 = LogOffset.new(100, 10)

      state = %{state | txn_offset_mapping: [{offset1, boundary1}]}

      # Query for an offset not in the mapping but after offset1
      query_offset = LogOffset.new(150, 0)
      {state, result} = State.align_offset_to_txn_boundary(state, query_offset)

      assert result == query_offset
      assert state.txn_offset_mapping == []
    end

    test "handles empty mapping", %{state: state} do
      state = %{state | txn_offset_mapping: []}
      offset = LogOffset.new(100, 5)

      {state, result} = State.align_offset_to_txn_boundary(state, offset)
      assert result == offset
      assert state.txn_offset_mapping == []
    end
  end
end
