defmodule Electric.Shapes.Consumer.ChangeHandlingTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.ChangeHandling
  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.Shape

  import Support.ComponentSetup

  @moduletag :tmp_dir

  @inspector Support.StubInspector.new(
               tables: ["users"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                 %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}},
                 %{name: "value", type: "text", pk_position: nil, type_id: {28, 1}}
               ]
             )

  describe "process_changes/3 with move-ins" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      # Create a shape with dependencies (subquery)
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "skips change when value is in unresolved move-in with nil snapshot", %{state: state} do
      # Set up move-in state with a waiting move-in that has nil snapshot
      # This simulates a move-in that was triggered but query hasn't started yet
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "a96441e4-59bd-426d-aefe-66c7fef4ddd2",
          {["$sublink", "0"], MapSet.new([1])}
        )

      state = %{state | move_handling_state: move_handling_state}

      # Create a change that references the moved-in value (parent_id = 1)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "1", "parent_id" => "1", "value" => "11"},
        record: %{"id" => "1", "parent_id" => "1", "value" => "13"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"child\"/\"1\"",
        changed_columns: MapSet.new(["value"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      # The change should be skipped because:
      # 1. Its parent_id=1 matches the in-flight moved value
      # 2. The move-in has nil snapshot, meaning we don't know when it will be visible yet
      # 3. Therefore we should skip to avoid duplicates when move-in results arrive
      result = ChangeHandling.process_changes([change], state, ctx)

      # Should return empty changes since it should be skipped
      {filtered_changes, _state, count, _offset} = result

      assert filtered_changes == []

      assert count == 0
    end

    test "skips change when value is in unresolved move-in with known snapshot and xid is visible",
         %{state: state} do
      # Set up move-in state with a waiting move-in that has a known snapshot
      # xid 962 should be visible in snapshot {963, 963, []} (since 962 < 963)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "ab234061-eb07-4ef7-97c5-301ad2056280",
          {["$sublink", "0"], MapSet.new([1])}
        )
        |> MoveIns.set_snapshot("ab234061-eb07-4ef7-97c5-301ad2056280", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      # Create a change that references the moved-in value (parent_id = 1)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "1", "parent_id" => "1", "value" => "11"},
        record: %{"id" => "1", "parent_id" => "1", "value" => "13"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"1\"",
        changed_columns: MapSet.new(["value"])
      }

      # xid 962 is visible in snapshot {963, 963, []}
      ctx = %{xid: 962, extra_refs: %{}}

      result = ChangeHandling.process_changes([change], state, ctx)

      {filtered_changes, _state, count, _offset} = result

      assert filtered_changes == [],
             "Change should be skipped when value is in unresolved move-in and xid is visible"

      assert count == 0
    end

    test "keeps change but converts it to an insert if it covers the snapshot, and adds it to touched keys",
         %{state: state} do
      # Set up move-in state with a waiting move-in that has a known snapshot
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "ab234061-eb07-4ef7-97c5-301ad2056280",
          {["$sublink", "0"], MapSet.new([1])}
        )
        |> MoveIns.set_snapshot("ab234061-eb07-4ef7-97c5-301ad2056280", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      # Create a change that references the moved-in value (parent_id = 1)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "1", "parent_id" => "1", "value" => "11"},
        record: %{"id" => "1", "parent_id" => "1", "value" => "13"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"1\"",
        changed_columns: MapSet.new(["value"])
      }

      # xid 970 covers the snapshot
      ctx = %{
        xid: 970,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      result = ChangeHandling.process_changes([change], state, ctx)

      assert {[change], state, 1, _offset} = result

      assert %NewRecord{record: %{"id" => "1", "parent_id" => "1", "value" => "13"}, key: key} =
               change

      assert state.move_handling_state.touch_tracker == %{key => 970}
    end
  end
end
