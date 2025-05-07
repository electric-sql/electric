defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true
  use Support.Mock

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape

  import Mox

  setup :verify_on_exit!

  defp shape! do
    assert {:ok, %Shape{where: %{query: "value = 'test'"}} = shape} =
             Shape.new("other_table", inspector: {__MODULE__, []}, where: "value = 'test'")

    shape
  end

  defp shape2! do
    assert {:ok, %Shape{where: nil} = shape} =
             Shape.new("public.table", inspector: {__MODULE__, []})

    shape
  end

  defp table_name,
    do:
      :ets.new(:"#{__MODULE__}-#{System.unique_integer([:positive, :monotonic])}", [
        :public,
        :ordered_set
      ])

  defp new_state(_ctx, opts \\ []) do
    table = Keyword.get(opts, :table, table_name())

    Mock.Storage
    |> expect(:get_all_stored_shapes, 1, fn _ -> {:ok, Access.get(opts, :stored_shapes, %{})} end)

    {:ok, state} =
      ShapeStatus.initialise(
        storage: {Mock.Storage, []},
        shape_meta_table: table
      )

    shapes = Keyword.get(opts, :shapes, [])

    shape_handles =
      for shape <- shapes do
        {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
        shape_handle
      end

    {:ok, state, shape_handles}
  end

  test "starts empty", ctx do
    {:ok, state, []} = new_state(ctx)
    assert [] = ShapeStatus.list_shapes(state)
  end

  test "can recover shapes from storage", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

    {:ok, state, []} =
      new_state(ctx,
        stored_shapes: %{
          shape_handle => shape
        }
      )

    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

    assert [^shape_handle] =
             ShapeStatus.list_shape_handles_for_relations(state, [
               {shape.root_table_id, {"public", "other_table"}}
             ])
  end

  test "can add shapes", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)
  end

  test "can delete shape instances", ctx do
    {:ok, state, []} = new_state(ctx)
    shape_1 = shape!()
    assert {:ok, shape_handle_1} = ShapeStatus.add_shape(state, shape_1)

    shape_2 = shape2!()

    assert {:ok, shape_handle_2} = ShapeStatus.add_shape(state, shape_2)

    assert Enum.sort_by([{shape_handle_1, shape_1}, {shape_handle_2, shape_2}], &elem(&1, 0)) ==
             ShapeStatus.list_shapes(state) |> Enum.sort_by(&elem(&1, 0))

    assert {:ok, ^shape_1} = ShapeStatus.remove_shape(state, shape_handle_1)
    assert [{^shape_handle_2, ^shape_2}] = ShapeStatus.list_shapes(state)

    assert [^shape_handle_2] =
             ShapeStatus.list_shape_handles_for_relations(state, [
               {shape_2.root_table_id, {"public", "table"}}
             ])

    assert [] =
             ShapeStatus.list_shape_handles_for_relations(state, [
               {shape_1.root_table_id, {"public", "other_table"}}
             ])
  end

  test "get_existing_shape/2 with %Shape{}", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()

    refute ShapeStatus.get_existing_shape(state, shape)

    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(state, shape)
  end

  test "get_existing_shape/2 with shape_handle", ctx do
    shape = shape!()
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape])

    refute ShapeStatus.get_existing_shape(state, "1234")

    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape_handle)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(state, shape)
    refute ShapeStatus.get_existing_shape(state, shape_handle)
  end

  test "get_existing_shape/2 public api", ctx do
    shape = shape!()
    table = table_name()

    {:ok, state, [shape_handle]} = new_state(ctx, table: table, shapes: [shape])

    refute ShapeStatus.get_existing_shape(table, "1234")

    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape_handle)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(table, shape)
    refute ShapeStatus.get_existing_shape(table, shape_handle)
  end

  test "latest_offset", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(state, "sdfsodf")

    assert ShapeStatus.latest_offset(state, shape_handle) ==
             {:ok, LogOffset.last_before_real_offsets()}

    offset = LogOffset.new(100, 3)
    assert ShapeStatus.set_latest_offset(state, shape_handle, offset)

    # set latest offset for an unknown shape silently does nothing
    # this is because real-world race conditions mean that we may
    # still receive updates on a shape that is in the process of
    # being deleted
    assert ShapeStatus.set_latest_offset(state, "not my shape", offset)

    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, offset}
  end

  test "latest_offset public api", ctx do
    table_name = table_name()
    {:ok, _state, [shape_handle]} = new_state(ctx, table: table_name, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(table_name, "sdfsodf")

    assert ShapeStatus.latest_offset(table_name, shape_handle) ==
             {:ok, LogOffset.last_before_real_offsets()}

    offset = LogOffset.new(100, 3)

    assert ShapeStatus.set_latest_offset(table_name, "not my shape", offset)

    assert ShapeStatus.set_latest_offset(table_name, shape_handle, offset)
    assert ShapeStatus.latest_offset(table_name, shape_handle) == {:ok, offset}
  end

  test "initialise_shape/4", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    offset = LogOffset.new(100, 3)
    assert :ok = ShapeStatus.initialise_shape(state, shape_handle, 1234, offset)
    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, offset}
    assert ShapeStatus.snapshot_xmin(state, shape_handle) == {:ok, 1234}
  end

  test "snapshot_xmin/2", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])

    assert_raise MatchError, fn ->
      ShapeStatus.set_snapshot_xmin(state, "sdfsodf", 1234)
    end

    assert :error = ShapeStatus.snapshot_xmin(state, "sdfsodf")
    assert {:ok, nil} == ShapeStatus.snapshot_xmin(state, shape_handle)
    assert ShapeStatus.set_snapshot_xmin(state, shape_handle, 1234)
    assert {:ok, 1234} == ShapeStatus.snapshot_xmin(state, shape_handle)
  end

  test "snapshot_started?/2", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])

    refute ShapeStatus.snapshot_started?(state, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state.shape_meta_table, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state, shape_handle)

    ShapeStatus.mark_snapshot_started(state, shape_handle)

    assert ShapeStatus.snapshot_started?(state, shape_handle)
    assert ShapeStatus.snapshot_started?(state.shape_meta_table, shape_handle)
  end

  describe "least_recently_used/2" do
    test "returns last shape update_last_read_time_to_now was called on", ctx do
      {:ok, state, []} = new_state(ctx)
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())
      ShapeStatus.update_last_read_time_to_now(state, shape2)
      Process.sleep(10)
      ShapeStatus.update_last_read_time_to_now(state, shape1)

      assert [%{shape_handle: ^shape2}] = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns shape first created if update_last_read_time_to_now has not been called", ctx do
      {:ok, state, []} = new_state(ctx)
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, _shape2} = ShapeStatus.add_shape(state, shape2!())

      assert [%{shape_handle: ^shape1}] = ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if no shapes have been added", ctx do
      {:ok, state, []} = new_state(ctx)

      assert [] == ShapeStatus.least_recently_used(state, _count = 1)
    end

    test "returns empty list if all shapes have been deleted", ctx do
      {:ok, state, []} = new_state(ctx)
      {:ok, shape1} = ShapeStatus.add_shape(state, shape!())
      {:ok, shape2} = ShapeStatus.add_shape(state, shape2!())
      ShapeStatus.remove_shape(state, shape1)
      ShapeStatus.remove_shape(state, shape2)

      assert [] == ShapeStatus.least_recently_used(state, _count = 1)
    end
  end

  def load_column_info(1338, _),
    do:
      {:ok,
       [
         %{name: "id", type: :int8, type_id: {1, 1}, pk_position: 0, is_generated: false},
         %{name: "value", type: :text, type_id: {2, 2}, pk_position: nil, is_generated: false}
       ]}

  def load_column_info(1337, _),
    do: {:ok, [%{name: "id", type: :int8, type_id: {1, 1}, pk_position: 0, is_generated: false}]}

  def load_relation_oid({"public", "table"}, _), do: {:ok, {1337, {"public", "table"}}}

  def load_relation_oid({"public", "other_table"}, _),
    do: {:ok, {1338, {"public", "other_table"}}}
end
