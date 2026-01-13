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

  test "reduce_shape_handles/3", ctx do
    {handles, _shapes} =
      Enum.map(1..100, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        {:ok, _hash} = ShapeDb.add_shape(ctx.stack_id, shape, handle)
        {handle, shape}
      end)
      |> Enum.unzip()

    assert ShapeDb.reduce_shape_handles(
             ctx.stack_id,
             MapSet.new(),
             fn handle, acc -> MapSet.put(acc, handle) end
           ) == MapSet.new(handles)
  end

  test "shape_hash/2", ctx do
    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)
    shape2 = Shape.new!("items", inspector: @stub_inspector, where: "id = 1")
    handle2 = "handle-2"
    {:ok, hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    assert {:ok, ^hash1} = ShapeDb.shape_hash(ctx.stack_id, handle1)
    assert {:ok, ^hash2} = ShapeDb.shape_hash(ctx.stack_id, handle2)

    assert :error = ShapeDb.shape_hash(ctx.stack_id, "no-handle")
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

  test "mark_snapshot_started/2", ctx do
    refute ShapeDb.snapshot_started?(ctx.stack_id, "no-such-handle")
    assert :error = ShapeDb.mark_snapshot_started(ctx.stack_id, "no-such-handle")

    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    refute ShapeDb.snapshot_started?(ctx.stack_id, handle1)
    :ok = ShapeDb.mark_snapshot_started(ctx.stack_id, handle1)
    assert ShapeDb.snapshot_started?(ctx.stack_id, handle1)
  end

  test "mark_snapshot_complete/2", ctx do
    refute ShapeDb.snapshot_complete?(ctx.stack_id, "no-such-handle")
    assert :error = ShapeDb.mark_snapshot_complete(ctx.stack_id, "no-such-handle")

    shape1 = Shape.new!("items", inspector: @stub_inspector)
    handle1 = "handle-1"
    {:ok, _hash1} = ShapeDb.add_shape(ctx.stack_id, shape1, handle1)

    # should allow for marking a snapshot complete before the snapshot
    # has been marked started
    assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle1)
    assert ShapeDb.snapshot_started?(ctx.stack_id, handle1)
    assert ShapeDb.snapshot_complete?(ctx.stack_id, handle1)

    shape2 = Shape.new!("items", inspector: @stub_inspector)
    handle2 = "handle-2"
    {:ok, _hash2} = ShapeDb.add_shape(ctx.stack_id, shape2, handle2)

    refute ShapeDb.snapshot_started?(ctx.stack_id, handle2)
    :ok = ShapeDb.mark_snapshot_started(ctx.stack_id, handle2)
    assert ShapeDb.snapshot_started?(ctx.stack_id, handle2)

    refute ShapeDb.snapshot_complete?(ctx.stack_id, handle2)
    assert :ok = ShapeDb.mark_snapshot_complete(ctx.stack_id, handle2)
    assert ShapeDb.snapshot_complete?(ctx.stack_id, handle2)
  end

  defp make_valid_shape(ctx, shape, handle) do
    make_shape_with_snapshot_status(ctx, shape, handle,
      snapshot_started: true,
      snapshot_complete: true
    )
  end

  defp make_shape_with_snapshot_status(%{stack_id: stack_id}, shape, handle, opts \\ []) do
    snapshot_started? = Keyword.get(opts, :snapshot_started, false)
    snapshot_complete? = Keyword.get(opts, :snapshot_complete, false)

    {:ok, _hash1} = ShapeDb.add_shape(stack_id, shape, handle)

    if snapshot_started?, do: :ok = ShapeDb.mark_snapshot_started(stack_id, handle)

    if snapshot_started? and snapshot_complete?,
      do: :ok = ShapeDb.mark_snapshot_complete(stack_id, handle)

    {handle, shape}
  end

  test "validate_existing_shapes/1", ctx do
    valid_shapes =
      Enum.map(1..10, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        make_valid_shape(ctx, shape, handle)
      end)

    not_started =
      Enum.map(11..20, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        make_shape_with_snapshot_status(ctx, shape, handle)
      end)

    not_completed =
      Enum.map(21..30, fn n ->
        shape = Shape.new!("items", inspector: @stub_inspector, where: "id = #{n}")
        handle = "handle-#{n}"
        make_shape_with_snapshot_status(ctx, shape, handle, snapshot_started: true)
      end)

    for {handle, _shape} <- valid_shapes do
      assert ShapeDb.snapshot_started?(ctx.stack_id, handle)
      assert ShapeDb.snapshot_complete?(ctx.stack_id, handle)
    end

    for {handle, _shape} <- not_started do
      refute ShapeDb.snapshot_started?(ctx.stack_id, handle)
      refute ShapeDb.snapshot_complete?(ctx.stack_id, handle)
    end

    for {handle, _shape} <- not_completed do
      assert ShapeDb.snapshot_started?(ctx.stack_id, handle)
      refute ShapeDb.snapshot_complete?(ctx.stack_id, handle)
    end

    {remove_handles, _shapes} = Enum.unzip(not_started ++ not_completed)

    {:ok, invalid_handles, 10} = ShapeDb.validate_existing_shapes(ctx.stack_id)

    assert MapSet.new(invalid_handles) == MapSet.new(remove_handles)

    {handles, _shapes} = Enum.unzip(valid_shapes)

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
end
