defmodule Electric.ShapeCache.ShapeStatusTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.{Column, Relation}
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Shape
  alias Support.StubInspector

  alias Support.Mock
  import Mox

  setup :verify_on_exit!

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

    shape_ids =
      for shape <- shapes do
        {:ok, shape_id} = ShapeStatus.add_shape(state, shape)
        shape_id
      end

    {:ok, state, shape_ids}
  end

  test "starts empty", ctx do
    {:ok, state, []} = new_state(ctx)
    assert [] = ShapeStatus.list_shapes(state)
  end

  test "can recover shapes from storage", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_id} = ShapeStatus.add_shape(state, shape)

    {:ok, state, []} =
      new_state(ctx,
        stored_shapes: %{
          shape_id => shape
        }
      )

    assert [{^shape_id, ^shape}] = ShapeStatus.list_shapes(state)
  end

  test "can add shapes", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()
    assert {:ok, shape_id} = ShapeStatus.add_shape(state, shape)
    assert [{^shape_id, ^shape}] = ShapeStatus.list_shapes(state)
  end

  test "can delete shape instances", ctx do
    {:ok, state, []} = new_state(ctx)
    shape_1 = shape!()
    assert {:ok, shape_id_1} = ShapeStatus.add_shape(state, shape_1)

    shape_2 = shape2!()

    assert {:ok, shape_id_2} = ShapeStatus.add_shape(state, shape_2)

    assert Enum.sort_by([{shape_id_1, shape_1}, {shape_id_2, shape_2}], &elem(&1, 0)) ==
             ShapeStatus.list_shapes(state) |> Enum.sort_by(&elem(&1, 0))

    assert {:ok, ^shape_1} = ShapeStatus.remove_shape(state, shape_id_1)
    assert [{^shape_id_2, ^shape_2}] = ShapeStatus.list_shapes(state)
  end

  test "get_existing_shape/2 with %Shape{}", ctx do
    {:ok, state, []} = new_state(ctx)
    shape = shape!()

    refute ShapeStatus.get_existing_shape(state, shape)

    assert {:ok, shape_id} = ShapeStatus.add_shape(state, shape)
    assert {^shape_id, _} = ShapeStatus.get_existing_shape(state, shape)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_id)
    refute ShapeStatus.get_existing_shape(state, shape)
  end

  test "get_existing_shape/2 with shape_id", ctx do
    shape = shape!()
    {:ok, state, [shape_id]} = new_state(ctx, shapes: [shape])

    refute ShapeStatus.get_existing_shape(state, "1234")

    assert {^shape_id, _} = ShapeStatus.get_existing_shape(state, shape)
    assert {^shape_id, _} = ShapeStatus.get_existing_shape(state, shape_id)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_id)
    refute ShapeStatus.get_existing_shape(state, shape)
    refute ShapeStatus.get_existing_shape(state, shape_id)
  end

  test "get_existing_shape/2 public api", ctx do
    shape = shape!()
    table = table_name()

    {:ok, state, [shape_id]} = new_state(ctx, table: table, shapes: [shape])

    refute ShapeStatus.get_existing_shape(table, "1234")

    assert {^shape_id, _} = ShapeStatus.get_existing_shape(table, shape)
    assert {^shape_id, _} = ShapeStatus.get_existing_shape(table, shape_id)

    assert {:ok, ^shape} = ShapeStatus.remove_shape(state, shape_id)
    refute ShapeStatus.get_existing_shape(table, shape)
    refute ShapeStatus.get_existing_shape(table, shape_id)
  end

  test "latest_offset", ctx do
    {:ok, state, [shape_id]} = new_state(ctx, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(state, "sdfsodf")
    assert ShapeStatus.latest_offset(state, shape_id) == {:ok, LogOffset.first()}
    offset = LogOffset.new(100, 3)
    assert ShapeStatus.set_latest_offset(state, shape_id, offset)
    refute ShapeStatus.set_latest_offset(state, "not my shape", offset)
    assert ShapeStatus.latest_offset(state, shape_id) == {:ok, offset}
  end

  test "latest_offset public api", ctx do
    table_name = table_name()
    {:ok, _state, [shape_id]} = new_state(ctx, table: table_name, shapes: [shape!()])
    assert :error = ShapeStatus.latest_offset(table_name, "sdfsodf")
    assert ShapeStatus.latest_offset(table_name, shape_id) == {:ok, LogOffset.first()}
    offset = LogOffset.new(100, 3)
    refute ShapeStatus.set_latest_offset(table_name, "not my shape", offset)
    assert ShapeStatus.set_latest_offset(table_name, shape_id, offset)
    assert ShapeStatus.latest_offset(table_name, shape_id) == {:ok, offset}
  end

  test "initialise_shape/4", ctx do
    {:ok, state, [shape_id]} = new_state(ctx, shapes: [shape!()])
    offset = LogOffset.new(100, 3)
    assert :ok = ShapeStatus.initialise_shape(state, shape_id, 1234, offset)
    assert ShapeStatus.latest_offset(state, shape_id) == {:ok, offset}
    assert ShapeStatus.snapshot_xmin(state, shape_id) == {:ok, 1234}
  end

  test "snapshot_xmin/2", ctx do
    {:ok, state, [shape_id]} = new_state(ctx, shapes: [shape!()])

    refute ShapeStatus.set_snapshot_xmin(state, "sdfsodf", 1234)

    assert :error = ShapeStatus.snapshot_xmin(state, "sdfsodf")
    assert {:ok, nil} == ShapeStatus.snapshot_xmin(state, shape_id)
    assert ShapeStatus.set_snapshot_xmin(state, shape_id, 1234)
    assert {:ok, 1234} == ShapeStatus.snapshot_xmin(state, shape_id)
  end

  test "snapshot_started?/2", ctx do
    {:ok, state, [shape_id]} = new_state(ctx, shapes: [shape!()])

    refute ShapeStatus.snapshot_started?(state, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state.shape_meta_table, "sdfsodf")
    refute ShapeStatus.snapshot_started?(state, shape_id)

    ShapeStatus.mark_snapshot_started(state, shape_id)

    assert ShapeStatus.snapshot_started?(state, shape_id)
    assert ShapeStatus.snapshot_started?(state.shape_meta_table, shape_id)
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
  end

  def load_column_info({"public", "other_table"}, _),
    do:
      {:ok,
       [
         %{name: "id", type: :int8, type_id: {1, 1}, pk_position: 0},
         %{name: "value", type: :text, type_id: {2, 2}, pk_position: nil}
       ]}

  def load_column_info({"public", "table"}, _),
    do: {:ok, [%{name: "id", type: :int8, pk_position: 0}]}

  def load_relation(tbl, _),
    do: StubInspector.load_relation(tbl, nil)
end
