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

  describe "process_changes/3 with subquery combined with other conditions" do
    # Tests for shapes that have a subquery ANDed with other non-subquery conditions.
    # The bug occurred when a change's sublink value was in a pending move-in, but
    # the record didn't match other parts of the WHERE clause. The old code would
    # incorrectly skip the change, assuming the move-in would cover it.
    #
    # Example: "parent_id IN (SELECT id FROM parents WHERE active) AND status = 'published'"
    # If parent becomes active (triggers move-in), but record has status='draft',
    # the change should NOT be skipped because the move-in won't return this row.

    @parents_inspector Support.StubInspector.new(
                         tables: ["parents", "children"],
                         columns: [
                           %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                           %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}},
                           %{name: "status", type: "text", pk_position: nil, type_id: {28, 1}},
                           %{name: "active", type: "bool", pk_position: nil, type_id: {16, 1}}
                         ]
                       )

    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      # Create a shape with a subquery AND a simple equality condition:
      # parent must be active AND child must be published
      shape =
        Shape.new!(
          "children",
          where:
            "parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'",
          inspector: @parents_inspector
        )

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "processes change when sublink is in move-in but record fails other WHERE conditions", %{
      state: state
    } do
      # This tests the fix: parent_id=3 enters a move-in (parent became active),
      # but the child has status='draft', so the change should NOT be skipped.
      # The move-in query uses the full WHERE clause, so it won't return this row.

      # Set up move-in state: parent_id=3 just became active (triggers move-in)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "move-in-for-parent-3",
          {["$sublink", "0"], MapSet.new([3])}
        )

      state = %{state | move_handling_state: move_handling_state}

      # A record moving FROM parent_id=1 (in shape) TO parent_id=3 (active but status=draft)
      # Old record: parent_id=1 active, status=published -> in shape
      # New record: parent_id=3 active, status=draft -> NOT in shape (fails status check)
      # This should result in a DELETE, not be skipped
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "1", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      # extra_refs: old has parent 1 active, new has parent 3 active
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      # The change should NOT be skipped - it should be processed as a delete
      # because the new record doesn't match status = 'published'
      assert count == 1
      assert length(filtered_changes) == 1

      [processed_change] = filtered_changes
      # Should be converted to a delete since old was in shape, new is not
      assert %Electric.Replication.Changes.DeletedRecord{} = processed_change
      assert processed_change.old_record["id"] == "100"
    end

    test "skips change when value is in move-in AND matches full WHERE clause", %{state: state} do
      # When parent_id=2 enters a move-in AND the record has status='published',
      # the change should be skipped (covered by move-in query)

      # Set up move-in state: parent_id=2 just became active (triggers move-in)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "move-in-for-parent-2",
          {["$sublink", "0"], MapSet.new([2])}
        )

      state = %{state | move_handling_state: move_handling_state}

      # A record with parent_id=2 and status=published being updated
      # Both subquery (parent active) and status condition are satisfied
      # This change should be skipped because the move-in will handle it
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new([])
      }

      # extra_refs: parent 2 is now active (in new refs)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      # The change should be skipped because:
      # 1. parent_id=2 is in the pending move-in
      # 2. status='published' satisfies the other WHERE condition
      # 3. The move-in query will return this row
      assert filtered_changes == []
      assert count == 0
    end

    test "processes delete when record fails non-subquery condition even with active move-in", %{
      state: state
    } do
      # When a record changes from status='published' to status='draft',
      # even if the parent is in a pending move-in, we should delete
      # because the status condition fails.

      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "move-in-for-parent-1",
          {["$sublink", "0"], MapSet.new([1])}
        )
        |> MoveIns.set_snapshot("move-in-for-parent-1", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      # Record changes status from published (in shape) to draft (not in shape)
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "200", "parent_id" => "1", "status" => "published"},
        record: %{"id" => "200", "parent_id" => "1", "status" => "draft"},
        log_offset: LogOffset.new(12346, 0),
        key: "\"public\".\"children\"/\"200\"",
        changed_columns: MapSet.new(["status"])
      }

      # xid 962 is visible in snapshot {963, 963, []}
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      # Should produce a delete, not be skipped
      assert count == 1
      assert [%Electric.Replication.Changes.DeletedRecord{} = delete] = filtered_changes
      assert delete.old_record["id"] == "200"
    end
  end
end
