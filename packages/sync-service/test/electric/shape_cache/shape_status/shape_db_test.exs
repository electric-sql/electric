defmodule Electric.ShapeCache.ShapeStatus.ShapeDbTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus.ShapeDb

  import Support.ComponentSetup

  @moduletag :tmp_dir

  @stub_inspector Support.StubInspector.new(
                    tables: [{1, {"public", "items"}}, {2, {"public", "other_table"}}],
                    columns: [
                      %{
                        name: "id",
                        type: "int8",
                        type_id: {20, 1},
                        pk_position: 0,
                        is_generated: false
                      },
                      %{name: "value", type: "text", type_id: {25, 1}, is_generated: false}
                    ]
                  )

  setup [:with_stack_id_from_test, :with_shape_db]

  test "add_shape inserts persistent shape data", ctx do
    assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"

    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    assert {:ok, [{^handle1, ^shape1}]} = ShapeDb.list_shapes(ctx.stack_id)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
    handle2 = "handle-2"

    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    assert {:ok, [{^handle1, ^shape1}, {^handle2, ^shape2}]} = ShapeDb.list_shapes(ctx.stack_id)
  end

  test "handle_exists?", ctx do
    assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"

    refute ShapeDb.handle_exists?(ctx.stack_id, handle1)
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    assert ShapeDb.handle_exists?(ctx.stack_id, handle1)
  end

  test "shape_handles_for_relations", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
    handle2 = "handle-2"
    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    shape3 = Shape.new!("other_table", inspector: @stub_inspector)
    handle3 = "handle-3"
    {:ok, _hash3} = ShapeDb.add_shape(ctx.stack_id, shape3, handle3)

    assert {:ok, [^handle1, ^handle2]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [{1, {"public", "items"}}])

    assert {:ok, [^handle3]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [{2, {"public", "other_table"}}])

    assert {:ok, [^handle1, ^handle2, ^handle3]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])
  end

  test "remove_shape", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
    handle2 = "handle-2"
    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    shape3 = Shape.new!("other_table", inspector: @stub_inspector)
    handle3 = "handle-3"
    {:ok, _hash3} = ShapeDb.add_shape(ctx.stack_id, shape3, handle3)

    assert {:ok, [{^handle1, ^shape1}, {^handle2, ^shape2}, {^handle3, ^shape3}]} =
             ShapeDb.list_shapes(ctx.stack_id)

    :ok = ShapeDb.remove_shape(ctx.stack_id, handle1)

    assert {:ok, [{^handle2, ^shape2}, {^handle3, ^shape3}]} = ShapeDb.list_shapes(ctx.stack_id)

    assert {:ok, [^handle2, ^handle3]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])

    :ok = ShapeDb.remove_shape(ctx.stack_id, handle3)

    assert {:ok, [{^handle2, ^shape2}]} = ShapeDb.list_shapes(ctx.stack_id)

    assert {:ok, [^handle2]} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])

    :ok = ShapeDb.remove_shape(ctx.stack_id, handle2)

    assert {:ok, []} =
             ShapeDb.shape_handles_for_relations(ctx.stack_id, [
               {1, {"public", "items"}},
               {2, {"public", "other_table"}}
             ])

    assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
  end

  test "remove non-existing shape", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    assert {:ok, 1} = ShapeDb.count_shapes(ctx.stack_id)

    assert {:error, "No shape matching \"no-such-handle\""} =
             ShapeDb.remove_shape(ctx.stack_id, "no-such-handle")

    assert {:ok, 1} = ShapeDb.count_shapes(ctx.stack_id)
  end

  test "handle_for_shape/2", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 99")

    assert {:ok, ^handle1} = ShapeDb.handle_for_shape(ctx.stack_id, shape1)

    assert :error = ShapeDb.handle_for_shape(ctx.stack_id, shape2)
  end

  test "handle_for_shape after flush returns shape from ETS retention", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

    # Shape should still be discoverable via ETS retention after flush
    assert {:ok, ^handle1} = ShapeDb.handle_for_shape(ctx.stack_id, shape1)
  end

  test "shape_for_handle", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    assert {:ok, ^shape1} = ShapeDb.shape_for_handle(ctx.stack_id, handle1)
    assert :error = ShapeDb.shape_for_handle(ctx.stack_id, "no-such-handle")
  end

  test "reduce_shapes/3", ctx do
    {handles, _shapes} =
      Enum.map(1..100, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
        {handle, shape}
      end)
      |> Enum.unzip()

    assert ShapeDb.reduce_shapes(
             ctx.stack_id,
             MapSet.new(),
             fn {handle, %Shape{} = _shape}, acc -> MapSet.put(acc, handle) end
           ) == MapSet.new(handles)
  end

  test "reduce_shape_meta/3", ctx do
    expected =
      Enum.map(1..100, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        {:ok, hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

        # Mark some shapes as snapshot_complete
        if rem(n, 2) == 0 do
          :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle)
          {handle, hash, true}
        else
          {handle, hash, false}
        end
      end)

    # reduce_shape_meta reads snapshot state from SQLite, so flush first
    ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

    assert ShapeDb.reduce_shape_meta(
             ctx.stack_id,
             MapSet.new(),
             fn {handle, hash, snapshot_complete}, acc ->
               MapSet.put(acc, {handle, hash, snapshot_complete})
             end
           ) == MapSet.new(expected)
  end

  test "count_shapes/1", ctx do
    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)

    Enum.each(1..100, fn n ->
      shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
      handle = "handle-#{n}"
      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      assert {:ok, n} == ShapeDb.count_shapes(ctx.stack_id)
    end)

    Enum.each(100..1//-1, fn n ->
      handle = "handle-#{n}"
      :ok = ShapeDb.remove_shape(ctx.stack_id, handle)
      assert {:ok, n - 1} == ShapeDb.count_shapes(ctx.stack_id)
    end)

    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)
  end

  test "mark_snapshot_complete/2", ctx do
    assert :error = ShapeDb.mark_snapshot_complete(ctx.stack_id, "no-such-handle")

    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    # should allow for marking a snapshot complete before the snapshot
    # has been marked started
    assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle1)

    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 2")
    handle2 = "handle-2"
    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle2)
  end

  defp make_valid_shape(ctx, shape, handle) do
    make_shape_with_snapshot_status(ctx, shape, handle, snapshot_complete: true)
  end

  defp make_shape_with_snapshot_status(%{stack_id: stack_id}, shape, handle, opts \\ []) do
    snapshot_complete? = Keyword.get(opts, :snapshot_complete, false)

    {:ok, _hash1} = ShapeDb.add_shape(stack_id, shape, handle)

    if snapshot_complete?,
      do: :ok = ShapeDb.mark_snapshot_complete(stack_id, handle)

    {handle, shape}
  end

  defp get_snapshot_states(stack_id) do
    ShapeDb.reduce_shape_meta(stack_id, %{}, fn {handle, _hash, complete}, acc ->
      Map.put(acc, handle, complete)
    end)
  end

  test "validate_existing_shapes/1", ctx do
    valid_shapes =
      Enum.map(1..10, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        make_valid_shape(ctx, shape, handle)
      end)

    not_completed =
      Enum.map(21..30, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        make_shape_with_snapshot_status(ctx, shape, handle)
      end)

    {remove_handles, _shapes} = Enum.unzip(not_completed)

    {:ok, invalid_handles, 10} = ShapeDb.validate_existing_shapes(ctx.stack_id)

    assert MapSet.new(invalid_handles) == MapSet.new(remove_handles)

    {handles, _shapes} = Enum.unzip(valid_shapes)

    # Remove flushed ETS entries so reduce_shapes only sees SQLite data.
    # In production the ETS buffer is empty at startup so this isn't needed.
    ShapeDb.WriteBuffer.remove_flushed(ctx.stack_id)

    assert ShapeDb.reduce_shapes(
             ctx.stack_id,
             MapSet.new(),
             fn {handle, %Shape{} = _shape}, acc -> MapSet.put(acc, handle) end
           ) == MapSet.new(handles)
  end

  test "reset/1", ctx do
    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)

    Enum.map(1..10, fn n ->
      shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
      handle = "handle-#{n}"
      make_valid_shape(ctx, shape, handle)
    end)

    assert {:ok, 10} = ShapeDb.count_shapes(ctx.stack_id)

    assert :ok = ShapeDb.reset(ctx.stack_id)

    assert ShapeDb.reduce_shapes(ctx.stack_id, 0, fn {_handle, %Shape{} = _shape}, acc ->
             acc + 1
           end) == 0

    assert {:ok, 0} = ShapeDb.count_shapes(ctx.stack_id)
  end

  describe "write buffer" do
    test "shapes visible while buffered and after flush", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

      assert {:ok, [{^handle, ^shape}]} = ShapeDb.list_shapes(ctx.stack_id)
      assert {:ok, ^shape} = ShapeDb.shape_for_handle(ctx.stack_id, handle)
      assert {:ok, ^handle} = ShapeDb.handle_for_shape(ctx.stack_id, shape)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      assert {:ok, [{^handle, ^shape}]} = ShapeDb.list_shapes(ctx.stack_id)
      assert {:ok, ^shape} = ShapeDb.shape_for_handle(ctx.stack_id, handle)
      assert {:ok, ^handle} = ShapeDb.handle_for_shape(ctx.stack_id, shape)
    end

    test "snapshot functions work on shapes only in SQLite", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      # Verify initial state: not complete
      assert %{^handle => false} = get_snapshot_states(ctx.stack_id)

      assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      # Verify snapshot complete
      assert %{^handle => true} = get_snapshot_states(ctx.stack_id)
    end

    test "snapshot functions fail for shapes pending removal", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)

      assert :error = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle)
    end

    test "remove cancels buffered add", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      assert {:ok, [{^handle, ^shape}]} = ShapeDb.list_shapes(ctx.stack_id)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)
      assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert {:ok, []} = ShapeDb.list_shapes(ctx.stack_id)
    end

    test "handle_exists? respects pending removes", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert ShapeDb.handle_exists?(ctx.stack_id, handle)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)
      refute ShapeDb.handle_exists?(ctx.stack_id, handle)
    end

    test "pending_count_diff/1", ctx do
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-0"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

      assert 1 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      assert :ok = ShapeDb.remove_shape(ctx.stack_id, handle)

      assert -1 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)
      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      {_handles1, _shapes} =
        Enum.map(1..10, fn n ->
          shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
          handle = "handle-#{n}"

          make_shape_with_snapshot_status(ctx, shape, handle, snapshot_complete: false)
        end)
        |> Enum.unzip()

      {handles2, _shapes} =
        Enum.map(11..20, fn n ->
          shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
          handle = "handle-#{n}"

          make_shape_with_snapshot_status(ctx, shape, handle, snapshot_complete: false)
        end)
        |> Enum.unzip()

      assert 20 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      Enum.each(handles2, &ShapeDb.remove_shape(ctx.stack_id, &1))

      assert 10 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)

      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      assert 0 = ShapeDb.WriteBuffer.pending_count_diff(ctx.stack_id)
    end

    test "flushed shapes remain discoverable via handle_for_shape and lookup_handle", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"
      {comparable, _hash} = Shape.comparable_hash(shape)

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

      # Flush to SQLite — entries should be retained in ETS with flushed_at set
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      # Should still be found via ETS buffer (retained after flush)
      assert {:ok, ^handle} = ShapeDb.WriteBuffer.lookup_handle(ctx.stack_id, comparable)
      assert {:ok, ^shape} = ShapeDb.WriteBuffer.lookup_shape(ctx.stack_id, handle)
      assert {:ok, ^handle} = ShapeDb.handle_for_shape(ctx.stack_id, shape)
    end

    test "remove_shape on a flushed entry works correctly", ctx do
      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)

      # Flush to SQLite — entries retained in ETS
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      # Remove the shape — should delete both {:shape, ...} and {:comparable, ...} immediately
      :ok = ShapeDb.remove_shape(ctx.stack_id, handle)

      assert :error = ShapeDb.handle_for_shape(ctx.stack_id, shape)
      assert :error = ShapeDb.shape_for_handle(ctx.stack_id, handle)
    end

    test "cleanup removes expired flushed entries", ctx do
      alias Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBufferCleaner

      shape = Shape.new!("items", inspector: @stub_inspector)
      handle = "handle-1"
      {comparable, _hash} = Shape.comparable_hash(shape)

      {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
      ShapeDb.WriteBuffer.flush_sync(ctx.stack_id)

      shapes_table = ShapeDb.WriteBuffer.shapes_table_name(ctx.stack_id)

      # Entries should be retained
      assert {:ok, ^handle} = ShapeDb.WriteBuffer.lookup_handle(ctx.stack_id, comparable)

      # A cutoff in the past should not delete entries flushed just now
      past_cutoff = System.monotonic_time() - System.convert_time_unit(60_000, :millisecond, :native)
      assert 0 = WriteBufferCleaner.delete_older_than(shapes_table, past_cutoff)
      assert {:ok, ^handle} = ShapeDb.WriteBuffer.lookup_handle(ctx.stack_id, comparable)
      assert {:ok, ^shape} = ShapeDb.WriteBuffer.lookup_shape(ctx.stack_id, handle)

      # A cutoff in the future should delete entries flushed just now
      future_cutoff = System.monotonic_time() + System.convert_time_unit(1_000, :millisecond, :native)
      assert 2 = WriteBufferCleaner.delete_older_than(shapes_table, future_cutoff)

      # Flushed entries should now be cleaned up from ETS
      assert :not_found = ShapeDb.WriteBuffer.lookup_handle(ctx.stack_id, comparable)
      assert :not_found = ShapeDb.WriteBuffer.lookup_shape(ctx.stack_id, handle)

      # But shape should still be accessible from SQLite
      assert {:ok, ^handle} = ShapeDb.handle_for_shape(ctx.stack_id, shape)
      assert {:ok, ^shape} = ShapeDb.shape_for_handle(ctx.stack_id, handle)
    end
  end
end
