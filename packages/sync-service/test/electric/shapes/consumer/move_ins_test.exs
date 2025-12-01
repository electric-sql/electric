defmodule Electric.Shapes.Consumer.MoveInsTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Replication.Changes.Transaction

  describe "new/0" do
    test "creates empty state" do
      state = MoveIns.new()

      assert state.waiting_move_ins == %{}
      assert state.filtering_move_ins == []
      assert state.move_in_buffering_snapshot == nil
    end
  end

  describe "add_waiting/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    test "adds a single move-in and creates buffering snapshot", %{state: state} do
      snapshot = {100, 200, [150]}
      state = MoveIns.add_waiting(state, "move1", snapshot)

      assert Map.has_key?(state.waiting_move_ins, "move1")
      assert state.waiting_move_ins["move1"] == snapshot
      assert state.move_in_buffering_snapshot == {100, 200, [150]}
    end

    test "combines multiple move-ins into union buffering snapshot", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, [150]})
        |> MoveIns.add_waiting("move2", {50, 250, [175]})

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
        |> MoveIns.add_waiting("move1", {100, 200, [150, 160]})
        |> MoveIns.add_waiting("move2", {90, 210, [160, 170]})

      {_xmin, _xmax, xip_list} = state.move_in_buffering_snapshot
      # Combined list has duplicates (that's fine for the visibility check)
      assert length(xip_list) == 4
    end
  end

  describe "change_to_filtering/3" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    test "moves from waiting to filtering", %{state: state} do
      snapshot = {100, 200, []}
      state = MoveIns.add_waiting(state, "move1", snapshot)

      key_set = ["key1", "key2"]
      state = MoveIns.change_to_filtering(state, "move1", key_set)

      assert state.waiting_move_ins == %{}
      assert [{^snapshot, ^key_set}] = state.filtering_move_ins
      assert state.move_in_buffering_snapshot == nil
    end

    test "keeps other waiting move-ins", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.add_waiting("move2", {150, 250, []})
        |> MoveIns.change_to_filtering("move1", ["key1"])

      assert Map.has_key?(state.waiting_move_ins, "move2")
      refute Map.has_key?(state.waiting_move_ins, "move1")
      assert state.move_in_buffering_snapshot == {150, 250, []}
    end

    test "raises on unknown move-in name", %{state: state} do
      assert_raise KeyError, fn ->
        MoveIns.change_to_filtering(state, "nonexistent", [])
      end
    end
  end

  describe "remove_completed/2" do
    setup do
      state = MoveIns.new()
      %{state: state}
    end

    test "removes move-ins where xid >= xmax", %{state: state} do
      # Move-in with xmax=200
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.change_to_filtering("move1", ["key1"])

      # Transaction with xid=200 (at xmax boundary - should complete)
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert state.filtering_move_ins == []
    end

    test "keeps move-ins where xid < xmax", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.change_to_filtering("move1", ["key1"])

      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert length(state.filtering_move_ins) == 1
    end

    test "removes only completed move-ins from multiple", %{state: state} do
      state =
        state
        |> MoveIns.add_waiting("move1", {100, 200, []})
        |> MoveIns.add_waiting("move2", {100, 300, []})
        |> MoveIns.change_to_filtering("move1", ["key1"])
        |> MoveIns.change_to_filtering("move2", ["key2"])

      # xid=250 completes move1 (xmax=200) but not move2 (xmax=300)
      txn = %Transaction{xid: 250, lsn: {0, 1}, changes: []}
      state = MoveIns.remove_completed(state, txn)

      assert length(state.filtering_move_ins) == 1
      assert [{{100, 300, []}, ["key2"]}] = state.filtering_move_ins
    end
  end
end
