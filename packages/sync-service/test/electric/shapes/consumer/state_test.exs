defmodule Electric.Shapes.Consumer.StateTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset

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
end
