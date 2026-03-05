defmodule Electric.Shapes.Consumer.StateTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.State
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

  describe "initialize_shape/3 write_unit" do
    setup [:with_stack_id_from_test]

    test "sets write_unit=txn_fragment for standalone shapes", %{stack_id: stack_id} do
      shape = %Shape{root_table: {"public", "items"}, root_table_id: 1}
      state = State.new(stack_id, "test-handle") |> State.initialize_shape(shape, %{})

      assert state.write_unit == :txn_fragment
    end

    test "sets write_unit=txn when shape has dependencies", %{stack_id: stack_id} do
      dep_shape = %Shape{root_table: {"public", "parent"}, root_table_id: 2}

      shape = %Shape{
        root_table: {"public", "items"},
        root_table_id: 1,
        shape_dependencies: [dep_shape]
      }

      state = State.new(stack_id, "test-handle") |> State.initialize_shape(shape, %{})

      assert state.write_unit == :txn
    end

    test "sets write_unit=txn when is_subquery_shape? is true", %{stack_id: stack_id} do
      shape = %Shape{root_table: {"public", "items"}, root_table_id: 1}

      state =
        State.new(stack_id, "test-handle")
        |> State.initialize_shape(shape, %{is_subquery_shape?: true})

      assert state.write_unit == :txn
    end
  end

  describe "initialize/3" do
    setup [:with_stack_id_from_test, :with_in_memory_storage]

    test "downgrades write_unit to :txn when storage does not support fragment streaming", %{
      stack_id: stack_id,
      storage: storage
    } do
      import ExUnit.CaptureLog

      # Shape without dependencies gets write_unit=:txn_fragment
      shape = %Shape{root_table: {"public", "items"}, root_table_id: 1}
      state = State.new(stack_id, "test-handle", shape)
      assert state.write_unit == :txn_fragment

      shape_storage = Electric.ShapeCache.Storage.for_shape("test-handle", storage)
      Electric.ShapeCache.Storage.start_link(shape_storage)
      writer = Electric.ShapeCache.Storage.init_writer!(shape_storage, shape)

      log =
        capture_log(fn ->
          initialized = State.initialize(state, shape_storage, writer)
          assert initialized.write_unit == :txn
        end)

      assert log =~ "does not support txn fragment streaming"
      assert log =~ "Falling back to full-transaction buffering"
    end
  end

  describe "or_with_subquery? field in new/3" do
    setup [:with_stack_id_from_test]

    for {where, expected} <- [
          # No WHERE clause
          {nil, false},

          # WHERE clause without subquery
          {"id = 1", false},
          {"id = 1 AND flag = true", false},
          {"id = 1 OR flag = true", false},

          # Subquery without OR
          {"id IN (SELECT id FROM parent)", false},
          {"id = 1 AND parent_id IN (SELECT id FROM parent)", false},
          {"parent_id IN (SELECT id FROM parent) AND id = 1", false},
          {"parent_id IN (SELECT id FROM parent) AND flag = true AND id = 1", false},

          # OR directly with subquery
          {"parent_id IN (SELECT id FROM parent) OR flag = true", true},
          {"flag = true OR parent_id IN (SELECT id FROM parent)", true},
          {"(parent_id IN (SELECT id FROM parent)) OR (flag = true)", true},

          # OR that is ANDed with subquery (OR not directly containing subquery)
          {"(id = 1 OR flag = true) AND parent_id IN (SELECT id FROM parent)", false},
          {"parent_id IN (SELECT id FROM parent) AND (id = 1 OR flag = true)", false},

          # Nested cases - OR with subquery in one branch
          {"id = 1 OR parent_id IN (SELECT id FROM parent)", true},
          {"id = 1 OR (flag = true AND parent_id IN (SELECT id FROM parent))", true},
          {"(id = 1 AND parent_id IN (SELECT id FROM parent)) OR flag = true", true},

          # Subquery has OR inside
          {"id IN (SELECT id FROM parent WHERE flag = true OR id = 2)", false},

          # Subquery has OR with nested subquery
          {"id IN (SELECT id FROM parent WHERE id = 2 OR id IN (SELECT id FROM grandparent))",
           false},

          # NOT should not change result
          {"NOT (parent_id IN (SELECT id FROM parent) OR flag = true)", true},
          {"parent_id NOT IN (SELECT id FROM parent) OR flag = true", true},
          {"parent_id NOT IN (SELECT id FROM parent)", false},
          {"NOT(parent_id IN (SELECT id FROM parent))", false}
        ] do
      @tag where: where, expected: expected
      test "#{inspect(where)} -> or_with_subquery?=#{expected}", %{
        stack_id: stack_id,
        where: where,
        expected: expected
      } do
        shape = Shape.new!("items", where: where, inspector: @inspector)

        state = State.new(stack_id, "test-handle", shape)

        assert state.or_with_subquery? == expected
      end
    end
  end

  describe "not_with_subquery? field in new/3" do
    setup [:with_stack_id_from_test]

    for {where, expected} <- [
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

          # Double NOT (cancels out, but still has NOT wrapping subquery in AST)
          {"NOT(NOT(parent_id IN (SELECT id FROM parent)))", true},

          # NOT on non-subquery part, subquery without NOT
          {"NOT(flag = true) AND parent_id IN (SELECT id FROM parent)", false},
          {"parent_id IN (SELECT id FROM parent) AND NOT(flag = true)", false}
        ] do
      @tag where: where, expected: expected
      test "#{inspect(where)} -> not_with_subquery?=#{expected}", %{
        stack_id: stack_id,
        where: where,
        expected: expected
      } do
        shape = Shape.new!("items", where: where, inspector: @inspector)

        state = State.new(stack_id, "test-handle", shape)

        assert state.not_with_subquery? == expected
      end
    end
  end
end
