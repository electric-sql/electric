defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true

  alias Electric.PersistentKV
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.{Column, Relation}
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape

  defp shape! do
    assert {:ok, %Shape{where: %{query: "value = 'test'"}} = shape} =
             Shape.new("other_table", inspector: {__MODULE__, nil}, where: "value = 'test'")

    shape
  end

  defp shape2! do
    assert {:ok, %Shape{where: nil} = shape} =
             Shape.new("public.table", inspector: {__MODULE__, nil})

    shape
  end

  defp table_name, do: :"#{__MODULE__}-#{System.unique_integer([:positive, :monotonic])}"

  setup do
    [kv: PersistentKV.Memory.new!()]
  end

  defp new_state(ctx, opts \\ []) do
    table = Keyword.get(opts, :table, table_name())

    {:ok, state} = ShapeStatus.initialise(persistent_kv: ctx.kv, shape_meta_table: table)

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

  test "can add and retain shapes", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert [{^shape_handle, ^shape}] = ShapeStatus.list_shapes(state)

    {:ok, state, []} = new_state(ctx)
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

    {:ok, state, []} = new_state(ctx)
    assert [{^shape_handle_2, ^shape_2}] = ShapeStatus.list_shapes(state)
  end

  test "get_existing_shape/2 with %Shape{}", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()

    refute ShapeStatus.get_existing_shape(state, shape)

    assert {:ok, shape_handle} = ShapeStatus.add_shape(state, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape)

    {:ok, state, []} = new_state(ctx)
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

    {:ok, state, []} = new_state(ctx)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(state, shape_handle)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(state, shape)
    refute ShapeStatus.get_existing_shape(state, shape_handle)
  end

  test "get_existing_shape/2 public api", ctx do
    shape = shape!()
    table = table_name()

    {:ok, _state, [shape_handle]} = new_state(ctx, table: table, shapes: [shape])

    refute ShapeStatus.get_existing_shape(table, "1234")

    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape_handle)

    table = table_name()

    {:ok, state, []} = new_state(ctx, table: table)

    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape)
    assert {^shape_handle, _} = ShapeStatus.get_existing_shape(table, shape_handle)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_handle)
    refute ShapeStatus.get_existing_shape(table, shape)
    refute ShapeStatus.get_existing_shape(table, shape_handle)
  end

  test "latest_offset", ctx do
    {:ok, state, [shape_handle]} = new_state(ctx, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(state, "sdfsodf")
    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, LogOffset.first()}
    offset = LogOffset.new(100, 3)
    assert ShapeStatus.set_latest_offset(state, shape_handle, offset)
    refute ShapeStatus.set_latest_offset(state, "not my shape", offset)
    assert ShapeStatus.latest_offset(state, shape_handle) == {:ok, offset}
  end

  test "latest_offset public api", ctx do
    table_name = table_name()
    {:ok, _state, [shape_handle]} = new_state(ctx, table: table_name, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(table_name, "sdfsodf")
    assert ShapeStatus.latest_offset(table_name, shape_handle) == {:ok, LogOffset.first()}
    offset = LogOffset.new(100, 3)
    refute ShapeStatus.set_latest_offset(table_name, "not my shape", offset)
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

    refute ShapeStatus.set_snapshot_xmin(state, "sdfsodf", 1234)

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

  test "relation data", ctx do
    relation_id = "relation_1"

    relation = %Relation{
      id: relation_id,
      schema: "public",
      table: "test_table",
      columns: [
        %Column{name: "id", type_oid: 1234},
        %Column{name: "name", type_oid: 2222}
      ]
    }

    {:ok, state, []} = new_state(ctx)

    refute ShapeStatus.get_relation(state, relation_id)
    assert :ok = ShapeStatus.store_relation(state, relation)

    assert relation == ShapeStatus.get_relation(state, relation_id)

    {:ok, state, []} = new_state(ctx)

    assert relation == ShapeStatus.get_relation(state, relation_id)
  end

  test "relation data public api", ctx do
    table = table_name()
    relation_id = "relation_1"

    relation = %Relation{
      id: relation_id,
      schema: "public",
      table: "test_table",
      columns: [
        %Column{name: "id", type_oid: 1234},
        %Column{name: "name", type_oid: 2222}
      ]
    }

    {:ok, state, []} = new_state(ctx, table: table)

    refute ShapeStatus.get_relation(table, relation_id)
    assert :ok = ShapeStatus.store_relation(state, relation)

    assert relation == ShapeStatus.get_relation(table, relation_id)

    table = table_name()

    {:ok, _state, []} = new_state(ctx, table: table)

    assert relation == ShapeStatus.get_relation(table, relation_id)
  end

  def load_column_info({"public", "other_table"}, _),
    do:
      {:ok,
       [
         %{name: "id", type: :int8, pk_position: 0},
         %{name: "value", type: :text, pk_position: nil}
       ]}

  def load_column_info({"public", "table"}, _),
    do: {:ok, [%{name: "id", type: :int8, pk_position: 0}]}
end
