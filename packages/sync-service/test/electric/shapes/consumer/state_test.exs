defmodule Electric.Shapes.Consumer.StateTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.Consumer.DnfContext
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset

  import Support.ComponentSetup

  @moduletag :tmp_dir

  @inspector Support.StubInspector.new(
               tables: [
                 {1, {"public", "items"}},
                 {2, {"public", "parent"}},
                 {2, {"public", "grandparent"}}
               ],
               columns: [
                 %{
                   name: "id",
                   type: "int8",
                   pk_position: 0,
                   type_id: {20, 1},
                   is_generated: false
                 },
                 %{
                   name: "parent_id",
                   type: "int8",
                   pk_position: nil,
                   type_id: {20, 1},
                   is_generated: false
                 },
                 %{
                   name: "flag",
                   type: "bool",
                   pk_position: nil,
                   type_id: {16, 1},
                   is_generated: false
                 }
               ]
             )

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
      assert state.initial_snapshot_state.pg_snapshot == nil
      assert state.storage == nil
      assert state.writer == nil
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

  # DnfContext replaces or_with_subquery? and not_with_subquery? fields.
  # Shapes with subqueries and OR/NOT now get a DnfContext built from the
  # DNF decomposition rather than simple boolean flags.
  describe "dnf_context field in new/3 — OR with subquery cases" do
    setup [:with_stack_id_from_test]

    for {where, has_multiple_disjuncts} <- [
          # No WHERE clause -> no dnf_context
          {nil, false},

          # WHERE clause without subquery -> no dnf_context (no deps)
          {"id = 1", false},
          {"id = 1 AND flag = true", false},
          {"id = 1 OR flag = true", false},

          # Subquery without OR -> single disjunct
          {"id IN (SELECT id FROM parent)", false},
          {"id = 1 AND parent_id IN (SELECT id FROM parent)", false},
          {"parent_id IN (SELECT id FROM parent) AND id = 1", false},
          {"parent_id IN (SELECT id FROM parent) AND flag = true AND id = 1", false},

          # OR directly with subquery -> multiple disjuncts
          {"parent_id IN (SELECT id FROM parent) OR flag = true", true},
          {"flag = true OR parent_id IN (SELECT id FROM parent)", true},
          {"(parent_id IN (SELECT id FROM parent)) OR (flag = true)", true},

          # OR that is ANDed with subquery (OR not directly containing subquery)
          # DNF distributes: (A OR B) AND C -> (A AND C) OR (B AND C) -> 2 disjuncts
          {"(id = 1 OR flag = true) AND parent_id IN (SELECT id FROM parent)", true},
          {"parent_id IN (SELECT id FROM parent) AND (id = 1 OR flag = true)", true},

          # Nested cases - OR with subquery in one branch
          {"id = 1 OR parent_id IN (SELECT id FROM parent)", true},
          {"id = 1 OR (flag = true AND parent_id IN (SELECT id FROM parent))", true},
          {"(id = 1 AND parent_id IN (SELECT id FROM parent)) OR flag = true", true},

          # Subquery has OR inside -> single disjunct (OR is inside the subquery, not outer)
          {"id IN (SELECT id FROM parent WHERE flag = true OR id = 2)", false},

          # Subquery has OR with nested subquery -> single disjunct
          {"id IN (SELECT id FROM parent WHERE id = 2 OR id IN (SELECT id FROM grandparent))",
           false},

          # NOT with OR -> distributes via De Morgan's
          {"NOT (parent_id IN (SELECT id FROM parent) OR flag = true)", false},
          {"parent_id NOT IN (SELECT id FROM parent) OR flag = true", true},
          {"parent_id NOT IN (SELECT id FROM parent)", false},
          {"NOT(parent_id IN (SELECT id FROM parent))", false}
        ] do
      @tag where: where, has_multiple_disjuncts: has_multiple_disjuncts
      test "#{inspect(where)} -> multiple_disjuncts=#{has_multiple_disjuncts}", %{
        stack_id: stack_id,
        where: where,
        has_multiple_disjuncts: has_multiple_disjuncts
      } do
        shape = Shape.new!("items", where: where, inspector: @inspector)

        state = State.new(stack_id, "test-handle", shape)

        if has_multiple_disjuncts do
          assert %DnfContext{} = state.dnf_context
          assert length(state.dnf_context.decomposition.disjuncts) > 1
        else
          # Either no dnf_context (no deps) or single disjunct
          case state.dnf_context do
            nil -> :ok
            %DnfContext{} -> assert length(state.dnf_context.decomposition.disjuncts) == 1
          end
        end
      end
    end
  end

  describe "dnf_context field in new/3 — NOT with subquery cases" do
    setup [:with_stack_id_from_test]

    for {where, has_negated_positions} <- [
          # No WHERE clause
          {nil, false},

          # WHERE clause without subquery (NOT doesn't matter without subquery)
          {"id = 1", false},
          {"NOT (id = 1)", false},
          {"NOT (id = 1 AND flag = true)", false},
          {"id = 1 AND NOT flag = true", false},

          # Subquery without NOT
          {"id IN (SELECT id FROM parent)", false},
          {"id = 1 AND parent_id IN (SELECT id FROM parent)", false},
          {"parent_id IN (SELECT id FROM parent) AND id = 1", false},
          {"parent_id IN (SELECT id FROM parent) OR flag = true", false},

          # x NOT IN (subquery) - the most common case
          {"parent_id NOT IN (SELECT id FROM parent)", true},
          {"parent_id NOT IN (SELECT id FROM parent) AND id = 1", true},
          {"id = 1 AND parent_id NOT IN (SELECT id FROM parent)", true},

          # NOT(x IN subquery) - equivalent to NOT IN
          {"NOT(parent_id IN (SELECT id FROM parent))", true},
          {"NOT (parent_id IN (SELECT id FROM parent))", true},

          # NOT(condition AND x IN subquery) - NOT wrapping expression with subquery
          {"NOT(flag = true AND parent_id IN (SELECT id FROM parent))", true},
          {"NOT(parent_id IN (SELECT id FROM parent) AND flag = true)", true},

          # NOT(condition OR x IN subquery) - NOT wrapping OR with subquery
          {"NOT(flag = true OR parent_id IN (SELECT id FROM parent))", true},
          {"NOT(parent_id IN (SELECT id FROM parent) OR flag = true)", true},

          # Nested NOT with subquery
          {"NOT(id = 1 AND (flag = true OR parent_id IN (SELECT id FROM parent)))", true},
          {"NOT((parent_id IN (SELECT id FROM parent)) AND id = 1)", true},

          # NOT inside subquery (shouldn't affect outer query)
          {"id IN (SELECT id FROM parent WHERE NOT flag = true)", false},
          {"id IN (SELECT id FROM parent WHERE id NOT IN (SELECT id FROM grandparent))", false},

          # NOT combined with AND/OR at outer level
          {"parent_id NOT IN (SELECT id FROM parent) OR flag = true", true},
          {"parent_id NOT IN (SELECT id FROM parent) AND flag = true", true},
          {"flag = true OR parent_id NOT IN (SELECT id FROM parent)", true},
          {"flag = true AND parent_id NOT IN (SELECT id FROM parent)", true},

          # Multiple subqueries with NOT
          {"parent_id NOT IN (SELECT id FROM parent) AND id IN (SELECT id FROM grandparent)",
           true},
          {"parent_id IN (SELECT id FROM parent) AND id NOT IN (SELECT id FROM grandparent)",
           true},

          # Double NOT (cancels out)
          {"NOT(NOT(parent_id IN (SELECT id FROM parent)))", false},

          # NOT on non-subquery part, subquery without NOT
          {"NOT(flag = true) AND parent_id IN (SELECT id FROM parent)", false},
          {"parent_id IN (SELECT id FROM parent) AND NOT(flag = true)", false}
        ] do
      @tag where: where, has_negated_positions: has_negated_positions
      test "#{inspect(where)} -> has_negated_positions=#{has_negated_positions}", %{
        stack_id: stack_id,
        where: where,
        has_negated_positions: has_negated_positions
      } do
        shape = Shape.new!("items", where: where, inspector: @inspector)

        state = State.new(stack_id, "test-handle", shape)

        if has_negated_positions do
          assert %DnfContext{} = state.dnf_context
          assert MapSet.size(state.dnf_context.negated_positions) > 0
        else
          # Either no dnf_context or no negated positions
          case state.dnf_context do
            nil -> :ok
            %DnfContext{} -> assert MapSet.size(state.dnf_context.negated_positions) == 0
          end
        end
      end
    end
  end
end
