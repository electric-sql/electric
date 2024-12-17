defmodule Electric.Shapes.PartitionedTablesTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache
  alias Electric.Postgres.Inspector

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup

  @partition_schema [
    ~s|CREATE TABLE "partitioned_items" (a INT, b INT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|,
    ~s|CREATE TABLE "partitioned_items_100" PARTITION OF "partitioned_items" FOR VALUES FROM (0) TO (99)|,
    ~s|CREATE TABLE "partitioned_items_200" PARTITION OF "partitioned_items" FOR VALUES FROM (100) TO (199)|
  ]

  @moduletag :tmp_dir
  @moduletag with_sql: @partition_schema

  setup [:with_unique_db, :with_complete_stack, :with_sql_execute]

  defp subscribe(shape_handle, ctx) do
    ref = make_ref()

    Registry.register(ctx.registry, shape_handle, ref)
    ref
  end

  test "subscriptions to root shape receive updates", ctx do
    {:ok, shape} = Shape.new("public.partitioned_items", inspector: ctx.inspector)

    {shape_handle, _} =
      ShapeCache.get_or_create_shape_handle(shape, stack_id: ctx.stack_id)

    :started = ShapeCache.await_snapshot_start(shape_handle, stack_id: ctx.stack_id)

    ref = subscribe(shape_handle, ctx)

    Postgrex.query!(
      ctx.db_conn,
      "INSERT INTO partitioned_items (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)",
      [1, 50, 2, 150, 3, 10]
    )

    assert_receive {^ref, :new_changes, _latest_log_offset}, 5000
  end

  test "new partition tables are accepted by root", ctx do
    {:ok, shape} = Shape.new("public.partitioned_items", inspector: ctx.inspector)

    {shape_handle, _} =
      ShapeCache.get_or_create_shape_handle(shape, stack_id: ctx.stack_id)

    :started = ShapeCache.await_snapshot_start(shape_handle, stack_id: ctx.stack_id)

    Postgrex.query!(
      ctx.db_conn,
      ~s|CREATE TABLE "partitioned_items_300" PARTITION OF "partitioned_items" FOR VALUES FROM (200) TO (299)|,
      []
    )

    ref = subscribe(shape_handle, ctx)

    Postgrex.query!(
      ctx.db_conn,
      "INSERT INTO partitioned_items (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)",
      [1, 250, 2, 260, 3, 200]
    )

    assert_receive {^ref, :new_changes, _latest_log_offset}, 5000
  end

  test "subscriptions to partitions receive updates", ctx do
    {:ok, shape} = Shape.new("public.partitioned_items_100", inspector: ctx.inspector)

    {shape_handle, _} =
      ShapeCache.get_or_create_shape_handle(shape, stack_id: ctx.stack_id)

    :started = ShapeCache.await_snapshot_start(shape_handle, stack_id: ctx.stack_id)

    ref = subscribe(shape_handle, ctx)

    Postgrex.query!(
      ctx.db_conn,
      "INSERT INTO partitioned_items (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)",
      [1, 50, 2, 150, 3, 10]
    )

    assert_receive {^ref, :new_changes, _latest_log_offset}, 5000
  end

  test "new partition tables prompt reload of relation info", ctx do
    {:ok, shape} = Shape.new("public.partitioned_items", inspector: ctx.inspector)

    {shape_handle, _} =
      ShapeCache.get_or_create_shape_handle(shape, stack_id: ctx.stack_id)

    :started = ShapeCache.await_snapshot_start(shape_handle, stack_id: ctx.stack_id)

    {:ok, relation} = Inspector.load_relation("partitioned_items", ctx.inspector)

    assert %{
             children: [
               {"public", "partitioned_items_100"},
               {"public", "partitioned_items_200"}
             ]
           } = relation

    Postgrex.query!(
      ctx.db_conn,
      ~s|CREATE TABLE "partitioned_items_300" PARTITION OF "partitioned_items" FOR VALUES FROM (200) TO (299)|,
      []
    )

    ref = subscribe(shape_handle, ctx)

    Postgrex.query!(
      ctx.db_conn,
      "INSERT INTO partitioned_items (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)",
      [1, 50, 2, 250, 3, 10]
    )

    assert_receive {^ref, :new_changes, _latest_log_offset}, 5000

    {:ok, relation} = Inspector.load_relation("partitioned_items", ctx.inspector)

    assert %{
             children: [
               {"public", "partitioned_items_100"},
               {"public", "partitioned_items_200"},
               {"public", "partitioned_items_300"}
             ]
           } = relation
  end
end
