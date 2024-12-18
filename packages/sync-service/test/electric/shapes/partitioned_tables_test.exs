defmodule Electric.Shapes.PartitionedTablesTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup

  @moduletag :tmp_dir
  setup [:with_unique_db, :with_complete_stack, :with_sql_execute]

  @tag with_sql: [
         # ~s|CREATE TABLE "partitioned_items" (a INT, b INT, PRIMARY KEY (a, b))|
         ~s|CREATE TABLE "partitioned_items" (a INT, b INT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|,
         ~s|CREATE TABLE "partitioned_items_100" PARTITION OF "partitioned_items" FOR VALUES FROM (0) TO (99)|,
         ~s|CREATE TABLE "partitioned_items_200" PARTITION OF "partitioned_items" FOR VALUES FROM (100) TO (199)|
       ]
  test "things", ctx do
    shape = %Shape{
      root_table: {"public", "partitioned_items"},
      root_table_id: 1,
      table_info: %{
        {"public", "partitioned_items"} => %{
          columns: [
            %{name: "a", type: "int4", type_id: {23, -1}, pk_position: 0},
            %{name: "b", type: "int4", type_id: {23, -1}, pk_position: 1}
          ],
          pk: ["a", "b"]
        }
      }
    }

    Electric.Postgres.Inspector.DirectInspector.load_relation(
      "public.partitioned_items",
      ctx.db_conn
    )
    |> dbg

    Electric.Postgres.Inspector.DirectInspector.load_relation(
      "public.partitioned_items_100",
      ctx.db_conn
    )
    |> dbg

    {shape_handle, _} =
      ShapeCache.get_or_create_shape_handle(shape, stack_id: ctx.stack_id) |> dbg

    Process.sleep(1000)

    Postgrex.query!(
      ctx.db_conn,
      "INSERT INTO partitioned_items (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)",
      [1, 50, 2, 150, 3, 10]
    )

    Process.sleep(4000)

    # Postgrex.query!(
    #   ctx.db_conn,
    #   ~s|CREATE TABLE "partitioned_items_300" PARTITION OF "partitioned_items" FOR VALUES FROM (200) TO (299)|,
    #   []
    # )

    # Process.sleep(1000)

    # Postgrex.query!(
    #   ctx.db_conn,
    #   "INSERT INTO partitioned_items (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)",
    #   [4, 50, 5, 250, 6, 10]
    # )

    ref = make_ref()
    # registry = Electric.ProcessRegistry.registry_name(ctx.stack_id)
    Registry.register(ctx.registry, shape_handle, ref)
    assert_receive {^ref, :new_changes, latest_log_offset}, 1000
    dbg(latest_log_offset)
  end
end
