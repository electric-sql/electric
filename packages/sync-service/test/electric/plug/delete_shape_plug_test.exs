defmodule Electric.Plug.DeleteShapePlugTest do
  use ExUnit.Case, async: true

  alias Electric.Plug.DeleteShapePlug
  alias Electric.Shapes.Shape

  import Support.ComponentSetup
  alias Support.Mock

  import Mox

  setup :verify_on_exit!
  @moduletag :capture_log

  @registry Registry.DeleteShapePlugTest

  @test_shape %Shape{
    root_table: {"public", "users"},
    root_table_id: :erlang.phash2({"public", "users"}),
    table_info: %{
      {"public", "users"} => %{
        columns: [%{name: "id", type: "int8", pk_position: 0, type_id: {20, -1}}],
        pk: ["id"]
      }
    }
  }
  @test_shape_handle "test-shape-handle"
  @test_pg_id "12345"

  def load_column_info({"public", "users"}, _),
    do: {:ok, @test_shape.table_info[{"public", "users"}][:columns]}

  def load_relation(tbl, _),
    do: Support.StubInspector.load_relation(tbl, nil)

  def conn(_ctx, method, "?" <> _ = query_string) do
    Plug.Test.conn(method, "/" <> query_string)
  end

  def call_delete_shape_plug(conn, ctx, allow \\ true) do
    config = [
      stack_id: ctx.stack_id,
      stack_events_registry: Registry.StackEvents,
      stack_ready_timeout: 100,
      pg_id: @test_pg_id,
      shape_cache: {Mock.ShapeCache, []},
      storage: {Mock.Storage, []},
      inspector: {__MODULE__, []},
      registry: @registry,
      long_poll_timeout: Access.get(ctx, :long_poll_timeout, 20_000),
      max_age: Access.get(ctx, :max_age, 60),
      stale_age: Access.get(ctx, :stale_age, 300),
      allow_shape_deletion: allow
    ]

    DeleteShapePlug.call(conn, config)
  end

  describe "DeleteShapePlug" do
    setup :with_stack_id_from_test

    setup ctx do
      start_link_supervised!({Registry, keys: :duplicate, name: @registry})

      {:via, _, {registry_name, registry_key}} =
        Electric.Replication.Supervisor.name(ctx)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)

      :ok
    end

    test "returns 404 if shape deletion is not allowed", ctx do
      conn =
        ctx
        |> conn("DELETE", "?table=.invalid_shape")
        |> call_delete_shape_plug(ctx, false)

      assert conn.status == 404

      assert Jason.decode!(conn.resp_body) == %{
               "status" => "Not found"
             }
    end

    test "returns 400 for invalid params", ctx do
      conn =
        ctx
        |> conn("DELETE", "?table=.invalid_shape")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "table" => [
                 "Invalid zero-length delimited identifier"
               ]
             }
    end

    test "should clean shape based on shape definition", ctx do
      Mock.ShapeCache
      |> expect(:get_or_create_shape_handle, fn @test_shape, _opts -> {@test_shape_handle, 0} end)
      |> expect(:clean_shape, fn @test_shape_handle, _ -> :ok end)

      conn =
        ctx
        |> conn(:delete, "?table=public.users")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 202
    end

    test "should clean shape based on shape_handle", ctx do
      Mock.ShapeCache
      |> expect(:clean_shape, fn @test_shape_handle, _ -> :ok end)

      conn =
        ctx
        |> conn(:delete, "?table=public.users&handle=#{@test_shape_handle}")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 202
    end
  end

  describe "stack not ready" do
    setup :with_stack_id_from_test

    test "returns 503", ctx do
      conn =
        ctx
        |> conn(:delete, "?table=public.users")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 503

      assert Jason.decode!(conn.resp_body) == %{"message" => "Stack not ready"}
    end
  end
end
