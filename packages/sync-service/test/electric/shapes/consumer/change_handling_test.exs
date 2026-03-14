defmodule Electric.Shapes.Consumer.ChangeHandlingTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.DeletedRecord
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

  # Used for WHERE clause evaluation tests with combined conditions
  @parents_inspector Support.StubInspector.new(
                       tables: ["parents", "children"],
                       columns: [
                         %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                         %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}},
                         %{name: "status", type: "text", pk_position: nil, type_id: {28, 1}},
                         %{name: "active", type: "bool", pk_position: nil, type_id: {16, 1}}
                       ]
                     )

  describe "baseline without parents" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "value ILIKE '%hello%'", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "INSERT matching shape is emitted as INSERT", %{state: state} do
      change = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{key: "\"public\".\"users\"/\"10\""}] = filtered_changes
    end
  end

  # =====================================================================
  # Baseline: no active move-ins
  # Algorithm doc: "If there are no active/recent moves for a shape,
  # then the processing is trivial." (line 19)
  # =====================================================================
  describe "baseline — no active move-ins" do
    @describetag :baseline
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "INSERT matching shape is emitted as INSERT", %{state: state} do
      change = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{key: "\"public\".\"users\"/\"10\""}] = filtered_changes
    end

    test "INSERT not matching shape is dropped", %{state: state} do
      change = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "99", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      # parent_id=99 is not in the linked set {1}
      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
    end

    test "UPDATE where both old and new match shape is emitted as UPDATE", %{state: state} do
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "old"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "new"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%UpdatedRecord{key: "\"public\".\"users\"/\"10\""}] = filtered_changes
    end

    test "UPDATE where old matches but new doesn't → emitted as DELETE", %{state: state} do
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "old"},
        record: %{"id" => "10", "parent_id" => "99", "value" => "new"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      # old parent_id=1 is in set, new parent_id=99 is not
      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%DeletedRecord{key: "\"public\".\"users\"/\"10\""}] = filtered_changes
    end

    test "UPDATE where old doesn't match but new does → emitted as INSERT", %{state: state} do
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "99", "value" => "old"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "new"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      # old parent_id=99 is not in set, new parent_id=1 is
      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{key: "\"public\".\"users\"/\"10\""}] = filtered_changes
    end

    test "UPDATE where neither old nor new match shape is dropped", %{state: state} do
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "99", "value" => "old"},
        record: %{"id" => "10", "parent_id" => "88", "value" => "new"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      # neither parent_id=99 nor parent_id=88 is in linked set {1}
      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
    end

    test "DELETE matching shape is emitted as DELETE", %{state: state} do
      change = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%DeletedRecord{key: "\"public\".\"users\"/\"10\""}] = filtered_changes
    end

    test "DELETE not matching shape is dropped", %{state: state} do
      change = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "99", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
    end
  end

  # =====================================================================
  # INSERTs [I.*]
  # Algorithm doc: lines 21-23
  # =====================================================================
  describe "INSERTs [I.*]" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "[I.1] INSERT not covered by MI → append + shadow", %{state: state} do
      # MI for parent_id=1 with known snapshot that does NOT cover xid=962
      # (xmax=960 <= xid=962 → not visible)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-1", {["$sublink", "0"], MapSet.new([1])})
        |> MoveIns.set_snapshot("mi-for-1", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      # extra_refs_old = full - in_flight = {1} - {1} = {}
      # extra_refs_new = full = {1}
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{}] = filtered_changes
      # Shadowed [1]
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[I.2] INSERT covered by MI (nil snapshot) + WHERE matches → skip", %{state: state} do
      # nil snapshot = will cover (algorithm line 69)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-1", {["$sublink", "0"], MapSet.new([1])})

      state = %{state | move_handling_state: move_handling_state}

      change = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert filtered_changes == []
      assert count == 0
    end

    test "[I.2] INSERT covered by MI (known snapshot) + WHERE matches → skip", %{state: state} do
      # Known snapshot covers xid=962 (xmax=963 > 962)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-1", {["$sublink", "0"], MapSet.new([1])})
        |> MoveIns.set_snapshot("mi-for-1", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      # xid=962 visible in {963,963,[]}
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert filtered_changes == []
      assert count == 0
    end
  end

  # =====================================================================
  # DELETEs [D.*]
  # Algorithm doc: lines 24-28
  # =====================================================================
  describe "DELETEs [D.*]" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "[D.1] DELETE not covered by MI → append + shadow", %{state: state} do
      # Known snapshot doesn't cover xid=962 (xmax=960)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-5", {["$sublink", "0"], MapSet.new([5])})
        |> MoveIns.set_snapshot("mi-for-5", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([5])}, %{["$sublink", "0"] => MapSet.new([])}},
        num_changes: 1
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%DeletedRecord{}] = filtered_changes
      # Algorithm says shadow [1]
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[D.2b] DELETE covered by MI (nil snapshot), not delegated → append, no shadow", %{
      state: state
    } do
      # nil snapshot = covers (algorithm line 69)
      # Key is not delegated (no prior [2] skip for this key)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-5", {["$sublink", "0"], MapSet.new([5])})

      state = %{state | move_handling_state: move_handling_state}

      change = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([5])}, %{["$sublink", "0"] => MapSet.new([])}},
        num_changes: 1
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%DeletedRecord{}] = filtered_changes
    end

    test "DELETE with old value NOT in any pending move-in → regular processing", %{state: state} do
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-5", {["$sublink", "0"], MapSet.new([5])})

      state = %{state | move_handling_state: move_handling_state}

      # old parent_id=7, not in any move-in
      change = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "7", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([7])}, %{["$sublink", "0"] => MapSet.new([])}},
        num_changes: 1
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%DeletedRecord{}] = filtered_changes
      refute Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[D.2a] DELETE covered by MI, key delegated → skip (INSERT+DELETE pair cancelled)", %{
      state: state
    } do
      # Step 1: INSERT with parent_id=5, covered by MI (nil snapshot) → [I.2] skip + delegate
      # Step 2: DELETE for same key, also covered → [D.2a] skip (delegated key)
      # The query sees INSERT+DELETE = nothing, returns nothing, log gets nothing.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-5", {["$sublink", "0"], MapSet.new([5])})

      state = %{state | move_handling_state: move_handling_state}

      insert = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(1000, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      insert_ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([5])}}
      }

      {filtered_changes, state, count, _offset} =
        ChangeHandling.process_changes([insert], state, insert_ctx)

      # INSERT skipped — delegated to MI
      assert count == 0
      assert filtered_changes == []
      assert Map.has_key?(state.move_handling_state.delegates, insert.key)

      # Step 2: DELETE for same key, also covered (nil snapshot)
      delete = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(1001, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      delete_ctx = %{
        xid: 101,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([5])}},
        num_changes: 1
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([delete], state, delete_ctx)

      # DELETE also skipped — delegated key, query handles both
      assert count == 0
      assert filtered_changes == []
      refute Map.has_key?(new_state.move_handling_state.shadows, delete.key)
    end
  end

  # =====================================================================
  # UPDATEs(a) - no sublink change, value references MI [Ua.*]
  # Algorithm doc: lines 30-32
  # =====================================================================
  describe "UPDATEs(a) - no sublink change [Ua.*]" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "[Ua.1] UPDATE not covered by MI → append + shadow", %{state: state} do
      # MI for parent_id=1 with known snapshot {963,963,[]}
      # xid=970 NOT visible (970 >= 963) → not covered
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "ab234061-eb07-4ef7-97c5-301ad2056280",
          {["$sublink", "0"], MapSet.new([1])}
        )
        |> MoveIns.set_snapshot("ab234061-eb07-4ef7-97c5-301ad2056280", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "1", "parent_id" => "1", "value" => "11"},
        record: %{"id" => "1", "parent_id" => "1", "value" => "13"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"1\"",
        changed_columns: MapSet.new(["value"])
      }

      # xid=970 not covered by snapshot
      ctx = %{
        xid: 970,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1

      assert [%NewRecord{record: %{"id" => "1", "parent_id" => "1", "value" => "13"}, key: key}] =
               filtered_changes

      assert %{^key => _} = new_state.move_handling_state.shadows
    end

    test "[Ua.2] UPDATE covered by MI (nil snapshot) → skip", %{state: state} do
      # nil snapshot = will cover (algorithm line 69)
      # Any WAL change arriving while snapshot is nil is guaranteed to be before
      # the eventual snapshot, so the MI query will include it.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "a96441e4-59bd-426d-aefe-66c7fef4ddd2",
          {["$sublink", "0"], MapSet.new([1])}
        )

      state = %{state | move_handling_state: move_handling_state}

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

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      assert filtered_changes == []
      assert count == 0
    end

    test "[Ua.2] UPDATE covered by MI (known snapshot, xid visible) → skip", %{state: state} do
      # xid=962 visible in snapshot {963,963,[]} (962 < 963) → covered
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting(
          "ab234061-eb07-4ef7-97c5-301ad2056280",
          {["$sublink", "0"], MapSet.new([1])}
        )
        |> MoveIns.set_snapshot("ab234061-eb07-4ef7-97c5-301ad2056280", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "1", "parent_id" => "1", "value" => "11"},
        record: %{"id" => "1", "parent_id" => "1", "value" => "13"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"1\"",
        changed_columns: MapSet.new(["value"])
      }

      # xid=962 visible in {963,963,[]}
      ctx = %{xid: 962, extra_refs: {%{}, %{}}}

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      assert filtered_changes == []
      assert count == 0
    end
  end

  # =====================================================================
  # UPDATEs(b) - sublink changes [Ub.1-4]
  # Algorithm doc: lines 33-46
  # =====================================================================
  describe "UPDATEs(b) - sublink changes, single MI [Ub.1-4]" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    # -------------------------------------------------------------------
    # [Ub.1]: old NOT in linked set, new in MI
    # -------------------------------------------------------------------

    test "[Ub.1a] old NOT in linked set, new in MI, MI doesn't cover → convert to insert, append + shadow",
         %{state: state} do
      # MI for parent_id=3 with known snapshot that doesn't cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 5 (not in linked set) to 3 (in MI)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: full - in_flight. 5 not in any set. 3 is in-flight.
      # extra_refs_new: full = {3}
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm: convert to insert, append + shadow [1]
      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "3"
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.1b] old NOT in linked set, new in MI, MI covers + WHERE matches → skip",
         %{state: state} do
      # MI for parent_id=3 with known snapshot covering xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 5 (not in any linked set) to 3 (in pending move-in)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([3])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert filtered_changes == []
      assert count == 0
    end

    # -------------------------------------------------------------------
    # [Ub.2]: old IS in linked set, new in MI (cross-sublink migration)
    # See also [P.cross] section below for the override rule
    # -------------------------------------------------------------------

    test "[Ub.2a] old in linked set, new in MI, MI doesn't cover → keep as update, append + shadow",
         %{state: state} do
      # MI for parent_id=3 with known snapshot that doesn't cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 2 (in linked set) to 3 (in MI, not covered)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {2} (2 is in linked set, not in-flight).
      # extra_refs_new: {2, 3} (full including MI value)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([2])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Per [P.cross]: old in linked set → emit + shadow (regardless of coverage)
      assert count == 1
      assert [%UpdatedRecord{} = emitted] = filtered_changes
      assert emitted.record["parent_id"] == "3"
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.2b/P.cross] old in linked set, new in MI, MI covers → emit + shadow (cross-sublink override)",
         %{state: state} do
      # MI for parent_id=3 with known snapshot covering xid=962
      # Per [P.cross], even though MI covers, we must emit because old value
      # was in linked set → row is already in the shape. MI can only INSERT,
      # which would duplicate.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 1 (in linked set) to 3 (in covered pending move-in)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Must emit (not skip) — row was already in shape via old linked value
      assert count == 1
      assert [%UpdatedRecord{}] = filtered_changes
      # Must shadow so the move-in query unconditionally skips this key
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[P.cross] cross-sublink UPDATE kept as UPDATE for snapshot row from initial snapshot",
         %{state: state} do
      # Row entered via initial snapshot.
      # Sublink changes from a linked-set value to an uncovered pending move-in value.
      # key_owned? is false, but old_value_in_linked_set? is true with no prior
      # move-outs → row is in the log from snapshot. Must keep as UPDATE.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 2 (in linked set) to 3 (in uncovered pending move-in)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([2])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Must emit as UPDATE (not converted to INSERT) — row is in log from snapshot
      assert count == 1
      assert [%UpdatedRecord{} = emitted] = filtered_changes
      assert emitted.record["parent_id"] == "3"
      # Must shadow so the move-in query skips this key
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    # -------------------------------------------------------------------
    # [Ub.3]: old in MI(A), new in linked set
    # -------------------------------------------------------------------

    test "[Ub.3a] old in MI(A), new in linked set, MI doesn't cover → convert to insert, append + shadow",
         %{state: state} do
      # MI for parent_id=2 with known snapshot that doesn't cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 2 (in MI) to 1 (in linked set, not in any MI)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {1} (linked). 2 is in-flight, subtracted.
      # extra_refs_new: {1, 2} (full)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm [Ub.3a]: convert to insert, append + shadow [1]
      assert count == 1
      assert [emitted] = filtered_changes
      assert emitted.record["parent_id"] == "1"
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.3b] old in MI(A), new in linked set, MI covers → convert to insert, append, NO shadow",
         %{state: state} do
      # MI for parent_id=2 with nil snapshot (= covers, algorithm line 69)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 2 (in MI) to 1 (in linked set)
      # MI covers, but row's link value changed away from MI value →
      # MI won't return this row → no need to shadow
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm [Ub.3b]: convert to insert, append, no explicit shadow_key.
      # The algorithm's "don't shadow" means shadow_key isn't called,
      # but this is harmless — MI covers and won't return this row anyway.
      assert count == 1
      assert length(filtered_changes) == 1
      refute Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    # -------------------------------------------------------------------
    # [Ub.4]: old in MI(A), new NOT in linked set
    # -------------------------------------------------------------------

    test "[Ub.4a] old in MI(A), new NOT in linked set, MI doesn't cover → don't append + shadow",
         %{state: state} do
      # MI for parent_id=2 with known snapshot that doesn't cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 2 (in MI) to 99 (not in linked set at all)
      # MI doesn't cover → MI might return this row as INSERT.
      # But the update removes the row from visibility (new value not in shape).
      # We don't emit (would be a naked DELETE without base INSERT), and shadow
      # so the MI result INSERT is also skipped.
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "99", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {} (2 is in-flight, subtracted). 99 not in anything.
      # extra_refs_new: {2} (MI value)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm [Ub.4a]: don't append, shadow [1]
      assert filtered_changes == []
      assert count == 0
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.4b] old in MI(A), new NOT in linked set, MI covers → skip", %{state: state} do
      # MI for parent_id=2 with nil snapshot (= covers)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 2 (in MI) to 99 (not in linked set)
      # MI covers → MI sees this update → MI won't return the row (link changed)
      # No emission, no shadow needed.
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "99", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new()}, %{["$sublink", "0"] => MapSet.new([2])}}
      }

      {_filtered_changes, new_state, _count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      refute Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end
  end

  # =====================================================================
  # UPDATEs(b) - cross-MI sublink changes [Ub.5-6]
  # Algorithm doc: lines 47-55
  # =====================================================================
  describe "UPDATEs(b) - cross-MI sublink changes [Ub.5-6]" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    # -------------------------------------------------------------------
    # [Ub.5]: old and new in SAME MI
    # -------------------------------------------------------------------

    test "[Ub.5a] old/new in same MI, MI doesn't cover → convert to insert, append + shadow",
         %{state: state} do
      # MI for both parent_id=2 and parent_id=3 (same MI)
      # Known snapshot that doesn't cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2-and-3", {["$sublink", "0"], MapSet.new([2, 3])})
        |> MoveIns.set_snapshot("mi-for-2-and-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 2 to 3 (both in same MI)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # Both 2 and 3 are in-flight
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm [Ub.5a]: convert to insert, append + shadow [1]
      assert count == 1
      assert [%NewRecord{}] = filtered_changes
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.5b] old/new in same MI, MI covers + WHERE matches → skip",
         %{state: state} do
      # MI for both parent_id=2 and parent_id=3 (same MI)
      # Known snapshot covering xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2-and-3", {["$sublink", "0"], MapSet.new([2, 3])})
        |> MoveIns.set_snapshot("mi-for-2-and-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert filtered_changes == []
      assert count == 0
    end

    # -------------------------------------------------------------------
    # [Ub.6]: old in MI(A), new in MI(B) — different MIs
    # -------------------------------------------------------------------

    test "[Ub.6a] old MI(A), new MI(B), both cover → skip", %{state: state} do
      # A for parent_id=2, B for parent_id=3 — both cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {963, 963, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # Both 2 and 3 are in-flight
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm [Ub.6a]: both cover + WHERE matches → skip [2]
      assert filtered_changes == []
      assert count == 0
    end

    test "[Ub.6b] old MI(A), new MI(B), neither covers → convert to insert, append + shadow both",
         %{state: state} do
      # A for parent_id=2, B for parent_id=3 — neither covers xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {960, 960, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm [Ub.6b]: convert to insert, append + shadow both [1]
      assert count == 1
      assert [%NewRecord{}] = filtered_changes
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.6c] old MI(A) doesn't cover, new MI(B) covers + WHERE matches → skip + shadow A",
         %{state: state} do
      # A for parent_id=2 — known snapshot NOT covering xid=962
      # B for parent_id=3 — known snapshot covering xid=962
      # Algorithm: B covers and WHERE matches → skip [2] + shadow for A only.
      # B will return this row with the correct value. A's stale result is
      # skipped via shadow.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {960, 960, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # Both 2 and 3 are in-flight (subtracted from old)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Skip — B will provide this row
      assert count == 0
      assert filtered_changes == []

      # Shadow A so its stale result is skipped
      key = change.key
      assert %{^key => {_, mi_names, _tags}} = new_state.move_handling_state.shadows
      assert "mi-A-for-2" in mi_names
      refute "mi-B-for-3" in mi_names
    end

    test "[Ub.6d] old MI(A) covers, new MI(B) doesn't cover → convert to insert, append + shadow both",
         %{state: state} do
      # A for parent_id=2 — known snapshot covering xid=962
      # B for parent_id=3 — known snapshot NOT covering xid=962
      # A sees the row with new_value (parent_id=3) but 3 is B's value → A won't return it
      # B sees the row with old_value (parent_id=2) but 2 is A's value → B won't return it
      # Neither query captures the row → must emit from WAL
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {963, 963, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Algorithm [Ub.6d]: convert to insert, append + shadow both [1]
      assert count == 1
      assert [%NewRecord{}] = filtered_changes
      assert Map.has_key?(new_state.move_handling_state.shadows, change.key)
    end
  end

  # =====================================================================
  # Shadowed key rule [P.shadow]
  # Algorithm doc: line 18
  # =====================================================================
  describe "shadowed key rule [P.shadow]" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "[P.shadow] non-sublink UPDATE for shadowed key emitted instead of skipped", %{
      state: state
    } do
      # Key is already shadowed by a prior emit.
      # A non-sublink update with new value in pending move-in would normally
      # be skipped. But since the key is shadowed, the move-in result for this
      # key will be unconditionally skipped, so we must emit the WAL change.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-1", {["$sublink", "0"], MapSet.new([1])})

      # Pre-shadow the key
      move_handling_state = %{
        move_handling_state
        | shadows: %{"\"public\".\"users\"/\"10\"" => {960, ["mi-for-1"]}}
      }

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "old"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "new"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["value"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Should emit instead of skip (shadow override)
      assert count == 1
      assert length(filtered_changes) == 1
    end

    test "[P.shadow] sublink-change UPDATE for shadowed key emitted when covered", %{
      state: state
    } do
      # Key is already shadowed. Sublink changes to a value in a covered pending
      # move-in. The shadowed-key rule forces emit regardless.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {963, 963, []})

      # Pre-shadow the key
      move_handling_state = %{
        move_handling_state
        | shadows: %{"\"public\".\"users\"/\"10\"" => {960, ["mi-for-3"]}}
      }

      state = %{state | move_handling_state: move_handling_state}

      # Sublink changes from 1 (linked set) to 3 (covered pending move-in)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # xid=962 visible in snapshot {963,963,[]} → covered by move-in
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Should emit instead of skip (shadow override)
      assert count == 1
      assert length(filtered_changes) == 1
    end

    test "[P.shadow] shadowed key bypasses filtering move-in skip", %{state: state} do
      # The key is in a filtering move-in's key_set. change_already_visible?
      # would return true, but the shadowed-key check runs first and forces emit.
      move_handling_state = MoveIns.new()

      move_handling_state = %{
        move_handling_state
        | filtering_move_ins: [
            {{900, 963, []}, MapSet.new(["\"public\".\"users\"/\"10\""]),
             {["$sublink", "0"], MapSet.new([1])}, 0, nil}
          ],
          shadows: %{"\"public\".\"users\"/\"10\"" => {960, ["mi-for-1"]}}
      }

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "old"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "new"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["value"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Should emit — shadowed-key check bypasses change_already_visible?
      assert count == 1
      assert length(filtered_changes) == 1
    end

    test "[P.shadow] DELETE for shadowed key still emits and clears the shadow", %{state: state} do
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-1", {["$sublink", "0"], MapSet.new([1])})

      move_handling_state = %{
        move_handling_state
        | shadows: %{"\"public\".\"users\"/\"10\"" => {960, ["mi-for-1"]}}
      }

      state = %{state | move_handling_state: move_handling_state}

      change = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}},
        num_changes: 1
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%DeletedRecord{}] = filtered_changes
      # Shadow is MI-name-bound, not explicitly released on DELETE
    end

    test "[P.shadow] cross-txn sublink chain: shadowed key emits UPDATE not INSERT", %{
      state: state
    } do
      # Two in-flight move-ins, row chains through both across transactions.
      # Txn 1: parent_id 1→5 (enters in-flight A). Emitted as UPDATE, key shadowed.
      # Txn 2: parent_id 5→7 (from A to B). Key is shadowed → always emits.
      # Bug: convert_change sees parent_id=5 NOT in extra_refs_old (subtracted as in-flight),
      # thinks old wasn't in shape → converts to INSERT. Should be UPDATE.
      snapshot_before_txns = {90, 95, []}

      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-5", {["$sublink", "0"], MapSet.new([5])})
        |> MoveIns.set_snapshot("mi-A-for-5", snapshot_before_txns)
        |> MoveIns.add_waiting("mi-B-for-7", {["$sublink", "0"], MapSet.new([7])})
        |> MoveIns.set_snapshot("mi-B-for-7", snapshot_before_txns)

      state = %{state | move_handling_state: move_handling_state}

      # Txn 1: parent_id 1→5 (from stable linked to in-flight A)
      change_1 = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(10000, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx_1 = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 5, 7])}}
      }

      {changes_1, state_after_txn1, count_1, _offset} =
        ChangeHandling.process_changes([change_1], state, ctx_1)

      assert count_1 == 1
      assert [%UpdatedRecord{}] = changes_1

      # Txn 2: parent_id 5→7 (from in-flight A to in-flight B)
      change_2 = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "7", "value" => "hello"},
        log_offset: LogOffset.new(10001, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx_2 = %{
        xid: 101,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 5, 7])}}
      }

      {changes_2, _state_after_txn2, count_2, _offset} =
        ChangeHandling.process_changes([change_2], state_after_txn1, ctx_2)

      assert count_2 == 1
      # Should be UPDATE since the row is already in the shape from txn 1
      assert [%UpdatedRecord{}] = changes_2
    end

    test "[P.shadow] UPDATE→DELETE for shadowed key releases shadow", %{state: state} do
      # Key is shadowed. UPDATE changes sublink to a value NOT in the linked set
      # → convert_change produces DELETE. Algorithm says: "Shadowing for a key is
      # released when a DELETE for that key is appended to the log."
      # The shadow must be released even though the DELETE came from conversion,
      # not from the original WAL change.
      move_handling_state = MoveIns.new()

      # Pre-shadow the key
      move_handling_state = %{
        move_handling_state
        | shadows: %{"\"public\".\"users\"/\"10\"" => {960, ["mi-for-1"]}}
      }

      state = %{state | move_handling_state: move_handling_state}

      # Sublink changes from 1 (in linked set) to 99 (NOT in any linked set)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "99", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs: both old and new use full refs (shadowed key override).
      # Value 1 in linked set, value 99 not → old in shape, new not → DELETE.
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Should emit as DELETE (row left shape)
      assert count == 1
      assert [%DeletedRecord{}] = filtered_changes
      # Shadow is MI-name-bound, not explicitly released on DELETE
    end

    @tag skip:
           "This is a known issue category, current system cannot deal with same-transation operations over one key"
    test "[P.shadow] two sublink changes to same key in same txn: INSERT then UPDATE", %{
      state: state
    } do
      # Two pending move-ins for parent_id=3 and parent_id=5.
      # Two changes to the SAME key in one transaction:
      #   Change 1: parent_id 2→3 (enters shape via in-flight value 3)
      #   Change 2: parent_id 3→5 (stays in shape, switching to in-flight value 5)
      # Bug: convert_change sees parent_id=3 NOT in extra_refs_old for change 2,
      # thinks old was NOT in shape → produces INSERT again.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.add_waiting("mi-for-5", {["$sublink", "0"], MapSet.new([5])})

      state = %{state | move_handling_state: move_handling_state}

      change_1 = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "x"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "x"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      change_2 = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "3", "value" => "x"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "x"},
        log_offset: LogOffset.new(12345, 1),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old = full - in_flight = {1,3,5} - {3,5} = {1}
      # extra_refs_new = full = {1,3,5}
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3, 5])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change_1, change_2], state, ctx)

      assert count == 2

      types = Enum.map(filtered_changes, & &1.__struct__)
      assert types == [NewRecord, UpdatedRecord]
    end
  end

  # =====================================================================
  # WHERE clause evaluation with combined conditions
  # Tests that the full WHERE clause (not just sublink) is evaluated
  # when deciding whether to skip a change.
  # =====================================================================
  describe "WHERE clause with combined conditions" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
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

    test "[Ua.2] skip requires full WHERE match, not just sublink: record failing non-subquery condition is processed",
         %{state: state} do
      # parent_id=3 enters a move-in (parent became active), but the child has
      # status='draft' → the change should NOT be skipped because the move-in
      # query uses the full WHERE clause and won't return this row.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-parent-3", {["$sublink", "0"], MapSet.new([3])})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "1", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      assert count == 1
      assert length(filtered_changes) == 1
      [processed_change] = filtered_changes
      # Should be converted to a delete since old was in shape, new is not
      assert %DeletedRecord{} = processed_change
      assert processed_change.old_record["id"] == "100"
    end

    test "[Ua.2] skip when sublink in MI AND full WHERE clause matches", %{state: state} do
      # parent_id=2 enters a move-in AND the record has status='published'
      # → the change should be skipped (covered by move-in query)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-parent-2", {["$sublink", "0"], MapSet.new([2])})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new([])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      assert filtered_changes == []
      assert count == 0
    end

    test "[Ua.2] WHERE fail: parent_id and status both change, MI covers, but new status=draft → emits DELETE",
         %{state: state} do
      # Record changes both parent_id (sublink) and status.
      # Old: parent_id=1 (linked set), status='published' → in shape.
      # New: parent_id=3 (in covering MI), status='draft' → WHERE fails.
      # Even though MI covers the sublink change, the full WHERE clause
      # doesn't match → can't skip, must emit as DELETE.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-parent-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-parent-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "200", "parent_id" => "1", "status" => "published"},
        record: %{"id" => "200", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12346, 0),
        key: "\"public\".\"children\"/\"200\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      # xid=962 visible in {963,963,[]}
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      result = ChangeHandling.process_changes([change], state, ctx)
      {filtered_changes, _state, count, _offset} = result

      assert count == 1
      assert [%DeletedRecord{} = delete] = filtered_changes
      assert delete.old_record["id"] == "200"
    end
  end

  # =====================================================================
  # [Ub.1] with combined WHERE conditions
  # Tests that sublink entry (old NOT in linked set, new in MI) interacts
  # correctly with non-sublink WHERE conditions.
  # Shape: parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'
  # =====================================================================
  describe "[Ub.1] with combined WHERE conditions" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
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

    test "[Ub.1a] new doesn't match WHERE (status=draft), MI doesn't cover → dropped",
         %{state: state} do
      # Old parent_id=5 (not in linked set), new parent_id=3 (in MI, not covered)
      # New status='draft' → full WHERE fails → row doesn't enter shape → drop
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "5", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {} (5 not in linked set, 3 is in-flight)
      # extra_refs_new: {3} (MI value)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.1a] new matches WHERE (status=published), MI doesn't cover → INSERT + shadow",
         %{state: state} do
      # Old parent_id=5 (not in linked set), new parent_id=3 (in MI, not covered)
      # New status='published' → full WHERE matches → row enters shape
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "5", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # [Ub.1a]: convert to insert, append + shadow
      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "3"
      assert inserted.record["status"] == "published"
      key = change.key
      assert %{^key => _} = new_state.move_handling_state.shadows
    end

    test "[Ub.1b] new doesn't match WHERE (status=draft), MI covers → dropped",
         %{state: state} do
      # Old parent_id=5 (not in linked set), new parent_id=3 (in MI, covers)
      # New status='draft' → full WHERE fails → MI query won't return this row
      # either → safe to drop
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "5", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.1b] new matches WHERE (status=published), MI covers → skip",
         %{state: state} do
      # Old parent_id=5 (not in linked set), new parent_id=3 (in MI, covers)
      # New status='published' → full WHERE matches → MI query will return this row → skip
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "5", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end
  end

  # =====================================================================
  # [Ub.2a] with combined WHERE conditions
  # Tests that sublink migration (old in linked set, new in MI, MI doesn't
  # cover) interacts correctly with non-sublink WHERE conditions.
  # Shape: parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'
  # =====================================================================
  describe "[Ub.2a] with combined WHERE conditions" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!(
          "children",
          where:
            "parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'",
          inspector: @parents_inspector
        )

      state = State.new(stack_id, "test-handle", shape)

      # MI for parent_id=3 with known snapshot that doesn't cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}
      %{state: state, shape: shape}
    end

    test "old doesn't match WHERE (status=draft), new doesn't match WHERE → dropped (neither in shape)",
         %{state: state} do
      # parent_id changes from 1 (linked set) to 3 (in MI, not covered)
      # But status='draft' for both → neither old nor new matches full WHERE
      # Old was never in shape, new won't be either → drop
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "1", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {1} (linked). extra_refs_new: {1, 3} (full including MI value)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "old matches WHERE (status=published), new doesn't match WHERE (status=draft) → DELETE",
         %{state: state} do
      # parent_id changes from 1 (linked set) to 3 (in MI, not covered)
      # Old has status='published' (matches shape), new has status='draft' (doesn't)
      # Row was in shape, now it's not → DELETE + shadow
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "1", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%DeletedRecord{} = delete] = filtered_changes
      assert delete.old_record["id"] == "100"
      # Shadow is released because a DELETE was appended to the log
      # (algorithm: "Shadowing for a key is released when a DELETE is appended")
      key = change.key
      refute is_map_key(new_state.move_handling_state.shadows, key)
    end

    test "old doesn't match WHERE (status=draft), new matches WHERE (status=published), MI doesn't cover → INSERT + shadow",
         %{state: state} do
      # parent_id changes from 1 (linked set) to 3 (in MI, not covered)
      # Old has status='draft' (not in shape), new has status='published' (in shape)
      # Row enters shape → INSERT + shadow
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "1", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "3"
      assert inserted.record["status"] == "published"
      key = change.key
      assert %{^key => _} = new_state.move_handling_state.shadows
    end

    test "old doesn't match WHERE (status=draft), new matches WHERE (status=published), MI covers → skip",
         %{state: state} do
      # Override MI to have a covering snapshot
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      # parent_id changes from 1 (linked set) to 3 (in MI, covers xid=962)
      # Old has status='draft' (not in shape), new has status='published' (matches WHERE)
      # MI covers and WHERE matches → skip, MI query will return this row
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "1", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "both match WHERE (status=published) → UPDATE + shadow",
         %{state: state} do
      # parent_id changes from 1 (linked set) to 3 (in MI, not covered)
      # Both old and new have status='published' → both match full WHERE
      # Row stays in shape with updated sublink → UPDATE + shadow
      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "1", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # Per [P.cross]/[Ub.2a]: old in linked set → emit as UPDATE + shadow
      assert count == 1
      assert [%UpdatedRecord{} = emitted] = filtered_changes
      assert emitted.record["parent_id"] == "3"
      assert emitted.record["status"] == "published"
      key = change.key
      assert %{^key => _} = new_state.move_handling_state.shadows
    end
  end

  # =====================================================================
  # [Ub.3] with combined WHERE conditions
  # Tests that sublink exit from MI (old in MI, new in linked set) interacts
  # correctly with non-sublink WHERE conditions.
  # Shape: parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'
  # =====================================================================
  describe "[Ub.3] with combined WHERE conditions" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
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

    test "[Ub.3a] new doesn't match WHERE (status=draft), MI doesn't cover → dropped",
         %{state: state} do
      # Old parent_id=2 (in MI, not covered), new parent_id=1 (in linked set)
      # New status='draft' → full WHERE fails → row doesn't enter shape → drop
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "1", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {1} (linked). 2 is in-flight, subtracted.
      # extra_refs_new: {1, 2} (full)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.3a] new matches WHERE (status=published), MI doesn't cover → INSERT + shadow",
         %{state: state} do
      # Old parent_id=2 (in MI, not covered), new parent_id=1 (in linked set)
      # New status='published' → full WHERE matches → row enters shape
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "1", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # [Ub.3a]: convert to insert, append + shadow
      # Note: shadow is set for the MI's old value, but since the new value
      # is in the linked set (not in MI), the key may not appear in shadows
      # when the old record didn't match WHERE (status='draft' → was never in shape).
      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "1"
      assert inserted.record["status"] == "published"
    end

    test "[Ub.3b] new doesn't match WHERE (status=draft), MI covers → dropped",
         %{state: state} do
      # Old parent_id=2 (in MI, covers), new parent_id=1 (in linked set)
      # New status='draft' → full WHERE fails → row doesn't enter shape
      # MI covers but link value changed away → MI won't return this row either
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "1", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1, 2])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.3b] new matches WHERE (status=published), MI covers → INSERT, no shadow",
         %{state: state} do
      # Old parent_id=2 (in MI, covers), new parent_id=1 (in linked set)
      # New status='published' → full WHERE matches → row enters shape
      # MI covers but link value changed away → MI won't return this row → no shadow needed
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "1", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1, 2])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # [Ub.3b]: convert to insert, append, no shadow
      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "1"
      assert inserted.record["status"] == "published"
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end
  end

  # =====================================================================
  # [Ub.4] with combined WHERE conditions
  # Tests that sublink exit to unknown (old in MI, new NOT in linked set)
  # interacts correctly with non-sublink WHERE conditions.
  # Shape: parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'
  # =====================================================================
  describe "[Ub.4] with combined WHERE conditions" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
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

    test "[Ub.4a] old matches WHERE (status=published), MI doesn't cover → no emit + shadow",
         %{state: state} do
      # Old parent_id=2 (in MI, not covered), new parent_id=99 (not in linked set)
      # Old status='published' → MI query (which doesn't see this update) would
      # return this row with the old values → must shadow to prevent stale insert
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "99", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {} (2 is in-flight, subtracted). 99 not in anything.
      # extra_refs_new: {2} (MI value)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # [Ub.4a]: don't append, shadow [1]
      assert count == 0
      assert filtered_changes == []
      key = change.key
      assert %{^key => _} = new_state.move_handling_state.shadows
    end

    test "[Ub.4a] old doesn't match WHERE (status=draft), MI doesn't cover → no emit, no shadow",
         %{state: state} do
      # Old parent_id=2 (in MI, not covered), new parent_id=99 (not in linked set)
      # Old status='draft' → MI query won't return this row anyway (full WHERE
      # fails) → shadow not needed
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "99", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.4a] old matches WHERE but new doesn't (status published→draft), MI doesn't cover → no emit + shadow",
         %{state: state} do
      # Old parent_id=2 (in MI, not covered), new parent_id=99 (not in linked set)
      # Old status='published' → MI would return this row → must shadow
      # New status='draft' → irrelevant, new sublink not in linked set anyway
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-for-2", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "99", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      key = change.key
      assert %{^key => _} = new_state.move_handling_state.shadows
    end

    test "[Ub.4b] old matches WHERE (status=published), MI covers → no emit, no shadow",
         %{state: state} do
      # Old parent_id=2 (in MI, covers via nil snapshot), new parent_id=99 (not in linked set)
      # MI covers → MI sees this update → MI won't return row (link changed)
      # No emission, no shadow needed
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "99", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {} (2 is in-flight, subtracted). extra_refs_new: {2} (full)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.4b] old doesn't match WHERE (status=draft), MI covers → no emit, no shadow",
         %{state: state} do
      # Old parent_id=2 (in MI, covers via nil snapshot), new parent_id=99 (not in linked set)
      # Old status='draft' → MI won't return this row anyway
      # MI covers → sees the update → definitely won't return it
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2", {["$sublink", "0"], MapSet.new([2])})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "99", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs_old: {} (2 is in-flight, subtracted). extra_refs_new: {2} (full)
      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end
  end

  # =====================================================================
  # [Ub.5] with combined WHERE conditions
  # Tests that sublink change within the SAME MI interacts correctly with
  # non-sublink WHERE conditions.
  # Shape: parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'
  # =====================================================================
  describe "[Ub.5] with combined WHERE conditions" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
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

    test "[Ub.5a] new matches WHERE (status=published), MI doesn't cover → INSERT + shadow",
         %{state: state} do
      # MI for both parent_id=2 and parent_id=3 (same MI), doesn't cover xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2-and-3", {["$sublink", "0"], MapSet.new([2, 3])})
        |> MoveIns.set_snapshot("mi-for-2-and-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "3"
      assert inserted.record["status"] == "published"
      key = change.key
      assert %{^key => _} = new_state.move_handling_state.shadows
    end

    test "[Ub.5a] new doesn't match WHERE (status=draft), MI doesn't cover → dropped",
         %{state: state} do
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2-and-3", {["$sublink", "0"], MapSet.new([2, 3])})
        |> MoveIns.set_snapshot("mi-for-2-and-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.5b] new matches WHERE (status=published), MI covers → skip",
         %{state: state} do
      # MI for both parent_id=2 and parent_id=3, covers xid=962
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2-and-3", {["$sublink", "0"], MapSet.new([2, 3])})
        |> MoveIns.set_snapshot("mi-for-2-and-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.5b] new doesn't match WHERE (status=draft), MI covers → dropped",
         %{state: state} do
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-2-and-3", {["$sublink", "0"], MapSet.new([2, 3])})
        |> MoveIns.set_snapshot("mi-for-2-and-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end
  end

  # =====================================================================
  # [Ub.6] with combined WHERE conditions
  # Tests that sublink change across DIFFERENT MIs interacts correctly with
  # non-sublink WHERE conditions.
  # Shape: parent_id IN (SELECT id FROM parents WHERE active = true) AND status = 'published'
  # =====================================================================
  describe "[Ub.6] with combined WHERE conditions" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
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

    # -------------------------------------------------------------------
    # [Ub.6a]: both MIs cover
    # -------------------------------------------------------------------

    test "[Ub.6a] new matches WHERE (status=published), both MIs cover → skip",
         %{state: state} do
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {963, 963, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    test "[Ub.6a] new doesn't match WHERE (status=draft), both MIs cover → skip",
         %{state: state} do
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {963, 963, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "draft"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end

    # -------------------------------------------------------------------
    # [Ub.6b]: neither MI covers
    # -------------------------------------------------------------------

    test "[Ub.6b] new matches WHERE (status=published), neither MI covers → INSERT + shadow both",
         %{state: state} do
      # Old status='published' so that MI_A is relevant (old record matches MI_A's WHERE)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {960, 960, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "3"
      assert inserted.record["status"] == "published"
      key = change.key
      assert %{^key => {_, mi_names, _tags}} = new_state.move_handling_state.shadows
      assert "mi-A-for-2" in mi_names
      assert "mi-B-for-3" in mi_names
    end

    test "[Ub.6b] new doesn't match WHERE (status published→draft), neither MI covers → skip + shadow A",
         %{state: state} do
      # Old status='published' so MI_A is relevant (old record matches MI_A's WHERE).
      # New status='draft' → WHERE fails → no emit.
      # But MI_A doesn't cover and would return the stale version (old values
      # match WHERE) → must shadow A.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {960, 960, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      key = change.key
      assert %{^key => {_, mi_names, _tags}} = new_state.move_handling_state.shadows
      assert "mi-A-for-2" in mi_names
    end

    # -------------------------------------------------------------------
    # [Ub.6c]: B (new) covers, A (old) doesn't
    # -------------------------------------------------------------------

    test "[Ub.6c] new matches WHERE (status=published), B covers A doesn't → skip + shadow A only",
         %{state: state} do
      # Old status='published' so MI_A is relevant (old record matches MI_A's WHERE)
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {960, 960, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      # B will return this row → skip
      assert count == 0
      assert filtered_changes == []
      # Shadow A only
      key = change.key
      assert %{^key => {_, mi_names, _tags}} = new_state.move_handling_state.shadows
      assert "mi-A-for-2" in mi_names
      refute "mi-B-for-3" in mi_names
    end

    test "[Ub.6c] new doesn't match WHERE (status published→draft), B covers A doesn't → skip + shadow A",
         %{state: state} do
      # Old status='published' so MI_A is relevant.
      # New status='draft' → B won't return this row (WHERE fails).
      # But A doesn't cover and would return the stale version (old values
      # match WHERE) → must shadow A to prevent stale insert.
      # Row doesn't belong in shape (current state fails WHERE) → no emit.
      # Same action as WHERE-match case: skip + shadow A.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {960, 960, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {963, 963, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      key = change.key
      assert %{^key => {_, mi_names, _tags}} = new_state.move_handling_state.shadows
      assert "mi-A-for-2" in mi_names
      refute "mi-B-for-3" in mi_names
    end

    # -------------------------------------------------------------------
    # [Ub.6d]: A (old) covers, B (new) doesn't
    # -------------------------------------------------------------------

    test "[Ub.6d] new matches WHERE (status=published), A covers B doesn't → INSERT + shadow both",
         %{state: state} do
      # Old status='published' so MI_A is relevant (old record matches MI_A's WHERE)
      # A sees row with new_value (not A's queried value) → A won't return it.
      # B doesn't see this update, sees old_value (not B's queried value) → B won't return it.
      # Neither captures → emit from WAL + shadow both.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {963, 963, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "published"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%NewRecord{} = inserted] = filtered_changes
      assert inserted.record["parent_id"] == "3"
      assert inserted.record["status"] == "published"
      key = change.key
      assert %{^key => {_, mi_names, _tags}} = new_state.move_handling_state.shadows
      assert "mi-A-for-2" in mi_names
      assert "mi-B-for-3" in mi_names
    end

    test "[Ub.6d] new doesn't match WHERE (status published→draft), A covers B doesn't → dropped",
         %{state: state} do
      # Old status='published' so MI_A is relevant
      # New status='draft' → WHERE fails → neither MI returns it
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-2", {["$sublink", "0"], MapSet.new([2])})
        |> MoveIns.set_snapshot("mi-A-for-2", {963, 963, []})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-B-for-3", {960, 960, []})

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "children"},
        old_record: %{"id" => "100", "parent_id" => "2", "status" => "published"},
        record: %{"id" => "100", "parent_id" => "3", "status" => "draft"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"children\"/\"100\"",
        changed_columns: MapSet.new(["parent_id", "status"])
      }

      ctx = %{
        xid: 962,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0
      assert filtered_changes == []
      refute is_map_key(new_state.move_handling_state.shadows, change.key)
    end
  end

  # =====================================================================
  # Regression tests
  # Non-branch-specific tests for specific bug scenarios
  # =====================================================================
  describe "regression tests" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "spurious delete after move-in completes: row never inserted but delete emitted", %{
      state: state
    } do
      # Reproduces scenario where:
      #   1. Move-in for parent_id=5 completes (filtering state)
      #   2. Move-in's query didn't return row id=16
      #   3. WAL event: row changes parent_id from 5 to 99
      #   4. Without fix: extra_refs_old includes 5 → old_in_shape=true → spurious DELETE
      #   5. With fix: consumer.ex subtracts filtering values → old NOT in shape → no emit
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("completed-move-in", {["$sublink", "0"], MapSet.new([5])})
        |> MoveIns.set_snapshot("completed-move-in", {960, 975, []})

      # The key_set does NOT include our row — the query didn't return it
      {_boundary, _trigger_gen, _mi_id, move_handling_state} =
        MoveIns.change_to_filtering(move_handling_state, "completed-move-in", MapSet.new([]))

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "16", "parent_id" => "5", "value" => "hello"},
        record: %{"id" => "16", "parent_id" => "99", "value" => "hello"},
        log_offset: LogOffset.new(12345, 0),
        key: "\"public\".\"users\"/\"16\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      # extra_refs after fix: filtering values subtracted from old
      ctx = %{
        xid: 970,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 5])}}
      }

      {_filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 0,
             "Should not emit a delete for a row that was never inserted into the shape."
    end

    test "sublink change from in-flight to in-flight emits UPDATE for already-emitted row", %{
      state: state
    } do
      # Row changed parent_id 2→3 in a prior txn (emitted as UPDATE, key shadowed).
      # Now parent_id 3→5, both 3 and 5 are in-flight.
      # Since key is shadowed, it must emit. convert_change with
      # already_shadowed=true uses extra_refs_full so old=3 is in shape → UPDATE.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-3", {["$sublink", "0"], MapSet.new([3])})
        |> MoveIns.set_snapshot("mi-for-3", {90, 95, []})
        |> MoveIns.add_waiting("mi-for-5", {["$sublink", "0"], MapSet.new([5])})
        |> MoveIns.set_snapshot("mi-for-5", {90, 95, []})

      # Key is shadowed from prior emit
      move_handling_state = %{
        move_handling_state
        | shadows: %{"\"public\".\"users\"/\"10\"" => {100, ["mi-for-3"]}}
      }

      state = %{state | move_handling_state: move_handling_state}

      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(10001, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx = %{
        xid: 101,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 3, 5])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      # Must be UPDATE, not INSERT — already_shadowed uses full extra_refs
      assert [%UpdatedRecord{}] = filtered_changes
    end
  end

  # =====================================================================
  # Multi-step delegation bugs
  # These test sequences of operations where a prior [2] skip (delegation)
  # interacts with a subsequent sublink change.
  # =====================================================================
  describe "delegation + sublink change" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "[Ub.6a] INSERT delegated to MI_A [I.2], then UPDATE changes sublink to MI_B — both cover, no shadow",
         %{state: state} do
      # Setup: two pending move-ins, both with nil snapshot (= will cover all WAL ops)
      #   MI_A for value 5, MI_B for value 3
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A", {["$sublink", "0"], MapSet.new([5])})
        |> MoveIns.add_waiting("mi-B", {["$sublink", "0"], MapSet.new([3])})

      state = %{state | move_handling_state: move_handling_state}

      # Step 1: INSERT with parent_id=5 → covered by MI_A (nil snapshot), WHERE matches → [I.2] skip
      insert = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(1000, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      insert_ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([5, 3])}}
      }

      {filtered_changes, state, count, _offset} =
        ChangeHandling.process_changes([insert], state, insert_ctx)

      # INSERT was skipped — delegated to MI_A
      assert count == 0
      assert filtered_changes == []

      # Step 2: UPDATE changes parent_id from 5 (MI_A) to 3 (MI_B)
      # Both MIs have nil snapshot → both "cover" this txn.
      # Code currently takes [Ub.1b]: new_in_mi?=true, WHERE matches → skip + shadow old.
      #
      # BUG: MI_A delegated the INSERT but won't return the row (parent_id is now 3).
      #       MI_B will see the row but the key gets shadowed → MI_B result skipped.
      #       Neither source provides the INSERT → UPDATE for absent key later.
      #
      # The UPDATE should either:
      #   (a) be emitted (as an INSERT, since the row isn't in the log), or
      #   (b) the delegation to MI_A should be tracked so we know it's broken
      update = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(1001, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      update_ctx = %{
        xid: 101,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([5, 3])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([update], state, update_ctx)

      # [Ub.6a] Both MIs cover → skip [2], no shadow.
      # MI_A sees the sublink change (parent_id=3, not 5) and won't return the row.
      # MI_B sees parent_id=3 and will return it. Key must NOT be shadowed so
      # MI_B's result is accepted.
      assert count == 0
      assert filtered_changes == []

      refute Map.has_key?(new_state.move_handling_state.shadows, update.key),
             "Key must not be shadowed — MI_B needs to provide the row"
    end

    test "INSERT delegated [I.2], then reparent to another MI, then DELETE → DELETE must not be skipped",
         %{state: state} do
      # Sequence:
      #   1. Move-ins for parent_id=5 (MI_A) and parent_id=3 (MI_B), both nil snapshot.
      #      Value 1 is already stable (in linked set).
      #   2. INSERT parent_id=5 → covered by MI_A, [I.2] skip + delegate
      #   3. UPDATE parent_id 5→3 (reparent from MI_A to MI_B) → [Ub.6a] skip
      #   4. DELETE parent_id=3 → covered by MI_B, key still in `delegates` from step 2
      #
      # Bug: key_delegated? sees the key in delegates (from the INSERT in step 2)
      # and the DELETE is covered by MI_B. If the delegation check doesn't
      # distinguish which MI delegated, the DELETE is incorrectly skipped.
      # But it SHOULD be skipped — the row was never in the log, so emitting
      # a DELETE would be an orphan DELETE.
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-5", {["$sublink", "0"], MapSet.new([5])})
        |> MoveIns.add_waiting("mi-B-for-3", {["$sublink", "0"], MapSet.new([3])})

      state = %{state | move_handling_state: move_handling_state}

      # Step 1: INSERT parent_id=5, covered by MI_A (nil snapshot) → [I.2] delegate
      insert = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(1000, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      insert_ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 5, 3])}}
      }

      {filtered_changes, state, count, _offset} =
        ChangeHandling.process_changes([insert], state, insert_ctx)

      assert count == 0
      assert filtered_changes == []
      assert Map.has_key?(state.move_handling_state.delegates, insert.key)

      # Step 2: UPDATE reparents parent_id 5→3 (from MI_A to MI_B)
      # Both MIs cover (nil snapshot) → [Ub.6a] skip
      update = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(1001, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      update_ctx = %{
        xid: 101,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 5, 3])}}
      }

      {update_changes, state, update_count, _offset} =
        ChangeHandling.process_changes([update], state, update_ctx)

      # Verify step 2: both MIs cover → [Ub.6a] skip
      assert update_count == 0, "UPDATE should be skipped, got #{inspect(update_changes)}"

      # Step 3: DELETE with parent_id=3, covered by MI_B (nil snapshot)
      # MI_B is relevant (old_record parent_id=3 matches MI_B's value set)
      delete = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "3", "value" => "hello"},
        log_offset: LogOffset.new(1002, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      delete_ctx = %{
        xid: 102,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1, 5, 3])}},
        num_changes: 1
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([delete], state, delete_ctx)

      # DELETE must be SKIPPED — the row was never in the log (INSERT delegated
      # to MI_A in step 1, UPDATE skipped via [Ub.6a] in step 2). MI_A sees
      # the reparent and won't return the row. MI_B sees the DELETE and won't
      # return it. Emitting a DELETE here would produce an orphan DELETE.
      assert count == 0
      assert filtered_changes == []
    end

    test "INSERT delegated [I.2], reparent to MI_B, MI_A resolves, DELETE → still delegated, skip",
         %{state: state} do
      # Sequence:
      #   1. MI_A for parent_id=1, MI_B for parent_id=2, both nil snapshot
      #   2. INSERT parent_id=1 → covered by MI_A → [I.2] delegate
      #   3. UPDATE parent_id 1→2 → covered by both → [Ub.6a] skip
      #   4. MI_A resolves (change_to_filtering with empty key_set — row not returned)
      #   5. DELETE parent_id=2 → MI_B covers it
      #
      # Bug: when MI_A resolves, the delegate entry (which was for MI_A) is
      # cleaned up. The DELETE in step 5 no longer finds the key in delegates,
      # so it's emitted — orphan DELETE (row was never in the log).
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-A-for-1", {["$sublink", "0"], MapSet.new([1])})
        |> MoveIns.add_waiting("mi-B-for-2", {["$sublink", "0"], MapSet.new([2])})

      state = %{state | move_handling_state: move_handling_state}

      # Step 1: INSERT parent_id=1, covered by MI_A (nil snapshot) → [I.2] delegate
      insert = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        log_offset: LogOffset.new(1000, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      insert_ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {filtered_changes, state, count, _offset} =
        ChangeHandling.process_changes([insert], state, insert_ctx)

      assert count == 0
      assert filtered_changes == []
      assert Map.has_key?(state.move_handling_state.delegates, insert.key)

      # Step 2: UPDATE reparents parent_id 1→2 (MI_A → MI_B)
      # Both cover (nil snapshot) → [Ub.6a] skip
      update = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "1", "value" => "hello"},
        record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        log_offset: LogOffset.new(1001, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      update_ctx = %{
        xid: 101,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1, 2])}}
      }

      {_filtered_changes, state, update_count, _offset} =
        ChangeHandling.process_changes([update], state, update_ctx)

      assert update_count == 0

      # Step 3: MI_A resolves with empty key_set (row had parent_id=2, not 1)
      {_boundary, _trigger_gen, _mi_id, move_handling_state} =
        MoveIns.change_to_filtering(state.move_handling_state, "mi-A-for-1", MapSet.new())

      state = %{state | move_handling_state: move_handling_state}

      # Step 4: DELETE with parent_id=2, covered by MI_B (nil snapshot)
      delete = %DeletedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "2", "value" => "hello"},
        log_offset: LogOffset.new(1002, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      delete_ctx = %{
        xid: 102,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([2])}},
        num_changes: 1
      }

      {filtered_changes, _new_state, count, _offset} =
        ChangeHandling.process_changes([delete], state, delete_ctx)

      # DELETE must be SKIPPED — row was never in the log. MI_A resolved without
      # it, MI_B covers the DELETE so also won't return it. Emitting would
      # produce an orphan DELETE.
      assert count == 0
      assert filtered_changes == []
    end

    test "INSERT delegated to MI [I.2], then uncovered UPDATE → delegation broken, emit + shadow",
         %{state: state} do
      # Step 1: INSERT with parent_id=5, covered by MI (snapshot covers xid=100) → [I.2] delegate
      # Step 2: UPDATE for same key, NOT covered (xid=200 > snapshot) → uncovered op on delegated key
      # Algorithm: "An uncovered operation on a delegated key transitions it from delegated to
      # shadowed — the WAL stream takes back authority."
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-5", {["$sublink", "0"], MapSet.new([5])})
        |> MoveIns.set_snapshot("mi-for-5", {150, 150, []})

      state = %{state | move_handling_state: move_handling_state}

      # Step 1: INSERT covered (xid=100 visible in snapshot {150,150,[]})
      insert = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "hello"},
        log_offset: LogOffset.new(1000, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      insert_ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([5])}}
      }

      {filtered_changes, state, count, _offset} =
        ChangeHandling.process_changes([insert], state, insert_ctx)

      assert count == 0
      assert filtered_changes == []
      assert Map.has_key?(state.move_handling_state.delegates, insert.key)

      # Step 2: UPDATE not covered (xid=200 NOT visible in snapshot {150,150,[]})
      # Non-sublink change — parent_id stays 5
      update = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "5", "value" => "old"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "new"},
        log_offset: LogOffset.new(2000, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["value"])
      }

      update_ctx = %{
        xid: 200,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([5])}}
      }

      {filtered_changes, new_state, count, _offset} =
        ChangeHandling.process_changes([update], state, update_ctx)

      # Uncovered op on delegated key → emit (WAL takes authority) + shadow
      # Emits as INSERT because the key was delegated (never in the log),
      # and extra_refs_old subtracts in-flight value 5, so old isn't seen as in-shape.
      assert count == 1
      assert [%NewRecord{}] = filtered_changes
      assert Map.has_key?(new_state.move_handling_state.shadows, update.key)
    end
  end

  # =====================================================================
  # Shadow-after-DELETE blocking re-INSERT
  # When an UPDATE converts to DELETE (row leaves shape), the decision engine
  # set shadow?=true (for the original UPDATE). track_change removes the key,
  # then shadow_key re-adds it. A later UPDATE that brings the row back
  # (converts to INSERT) is blocked by key_owned? in apply_converted_change.
  # Reduced from stable property test "deleted row id=3" (line 352).
  # =====================================================================
  # =====================================================================
  # [P.splice] Buffered move-in keys must not corrupt later UPDATE handling
  # When a key is in a buffered move-in AND in the initial snapshot,
  # a move-out that matches the buffered move-in's tag must not cause
  # a later normal UPDATE to be treated as a fresh INSERT.
  # =====================================================================
  describe "[P.splice] buffered move-in keys survive move-out without corrupting UPDATE handling" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "UPDATE for key in buffered move-in after move-out stays as UPDATE", %{
      state: state
    } do
      # Key 3 is in initial snapshot (parent_id=3) AND in a buffered move-in
      # (parent_id=1, tag_for_1). After move-out for value 1, a WAL UPDATE
      # for key 3 with parent_id=3 (base linked value) must remain an UPDATE,
      # not be converted to INSERT.
      tag_for_1 = "tag-for-value-1"

      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("mi-for-1", {["$sublink", "0"], MapSet.new([1])})
        |> MoveIns.set_snapshot("mi-for-1", {118, 119, []})
        |> MoveIns.buffer_completed_move_in(
          "mi-for-1",
          [{"\"public\".\"users\"/\"3\"", [tag_for_1]}],
          {118, 119, []}
        )
        |> MoveIns.move_out_happened(
          MapSet.new([tag_for_1]),
          {["$sublink", "0"], MapSet.new([1])}
        )

      state = %{state | move_handling_state: move_handling_state}

      # WAL UPDATE for key 3 with parent_id=3 (base linked value)
      change = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "3", "parent_id" => "3", "value" => "v1"},
        record: %{"id" => "3", "parent_id" => "3", "value" => "a"},
        log_offset: LogOffset.new(1017, 0),
        key: "\"public\".\"users\"/\"3\"",
        changed_columns: MapSet.new(["value"])
      }

      ctx = %{
        xid: 117,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([3])}, %{["$sublink", "0"] => MapSet.new([3])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([change], state, ctx)

      assert count == 1
      assert [%UpdatedRecord{key: "\"public\".\"users\"/\"3\""}] = filtered_changes
    end
  end

  describe "shadow-after-DELETE blocks re-INSERT" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      shape =
        Shape.new!("users", where: "parent_id IN (SELECT id FROM users)", inspector: @inspector)

      state = State.new(stack_id, "test-handle", shape)
      %{state: state, shape: shape}
    end

    test "UPDATE→DELETE + re-shadow, then UPDATE→INSERT must not be blocked by stale move-in state",
         %{state: state} do
      # Linked set: {6, 5}. No pending MIs needed to trigger the bug.
      # The key becomes "shadowed" (gen=0, move_out_gen=0) after the initial INSERT.

      # Step 1: INSERT id=1, parent_id=6 → in shape, emitted
      insert = %NewRecord{
        relation: {"public", "users"},
        record: %{"id" => "10", "parent_id" => "6", "value" => "x"},
        log_offset: LogOffset.new(1000, 0),
        key: "\"public\".\"users\"/\"10\""
      }

      ctx = %{
        xid: 100,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([6, 5])}, %{["$sublink", "0"] => MapSet.new([6, 5])}}
      }

      {[%NewRecord{}], state, 1, _} =
        ChangeHandling.process_changes([insert], state, ctx)

      # Step 2: UPDATE parent_id 6→3 → leaves shape, converted to DELETE
      # Key is shadowed (gen=0, move_out_gen=0). Decision: emit + shadow.
      # track_change removes key (DELETE), shadow_key re-adds it.
      update_out = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "6", "value" => "x"},
        record: %{"id" => "10", "parent_id" => "3", "value" => "x"},
        log_offset: LogOffset.new(1001, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx2 = %{
        xid: 101,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([6, 5])}, %{["$sublink", "0"] => MapSet.new([6, 5])}}
      }

      {[%DeletedRecord{}], state, 1, _} =
        ChangeHandling.process_changes([update_out], state, ctx2)

      # Shadow is released by the converted DELETE (algorithm: "Shadowing for a
      # key is released when a DELETE for that key is appended to the log")
      # Step 3: UPDATE parent_id 3→5 → re-enters shape, should be INSERT
      # Key is shadowed. Decision: emit + already_shadowed.
      # convert_change sees old=3 NOT in set, new=5 in set → NewRecord.
      # BUG: apply_converted_change sees key_owned? → true → SKIP.
      update_in = %UpdatedRecord{
        relation: {"public", "users"},
        old_record: %{"id" => "10", "parent_id" => "3", "value" => "x"},
        record: %{"id" => "10", "parent_id" => "5", "value" => "x"},
        log_offset: LogOffset.new(1002, 0),
        key: "\"public\".\"users\"/\"10\"",
        changed_columns: MapSet.new(["parent_id"])
      }

      ctx3 = %{
        xid: 102,
        extra_refs:
          {%{["$sublink", "0"] => MapSet.new([6, 5])}, %{["$sublink", "0"] => MapSet.new([6, 5])}}
      }

      {filtered_changes, _state, count, _offset} =
        ChangeHandling.process_changes([update_in], state, ctx3)

      # Row re-enters the shape. Must be emitted as INSERT.
      assert count == 1, "Re-entry INSERT must not be blocked by stale shadow state"
      assert [%NewRecord{}] = filtered_changes
    end
  end
end
