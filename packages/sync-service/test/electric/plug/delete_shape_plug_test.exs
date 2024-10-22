defmodule Electric.Plug.DeleteShapePlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Plug.DeleteShapePlug
  alias Electric.Shapes.Shape
  alias Electric.TenantManager

  import Support.ComponentSetup
  import Support.TestUtils, only: [with_electric_instance_id: 1]

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
  @test_shape_id "test-shape-id"
  @test_pg_id "12345"

  def load_column_info({"public", "users"}, _),
    do: {:ok, @test_shape.table_info[{"public", "users"}][:columns]}

  def load_relation(tbl, _),
    do: Support.StubInspector.load_relation(tbl, nil)

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  def conn(ctx, method, "?" <> _ = query_string, allow \\ true) do
    # Pass mock dependencies to the plug
    tenant = [
      electric_instance_id: ctx.electric_instance_id,
      tenant_id: ctx.tenant_id,
      pg_id: @test_pg_id,
      shape_cache: {Mock.ShapeCache, []},
      storage: {Mock.Storage, []},
      inspector: {__MODULE__, []},
      registry: @registry,
      long_poll_timeout: Access.get(ctx, :long_poll_timeout, 20_000),
      max_age: Access.get(ctx, :max_age, 60),
      stale_age: Access.get(ctx, :stale_age, 300)
    ]

    # because test mode creates a tenant by default
    TenantManager.delete_tenant(ctx.tenant_id)
    :ok = TenantManager.store_tenant(tenant)

    config = [
      storage: {Mock.Storage, []},
      tenant_manager: Electric.TenantManager,
      allow_shape_deletion: allow
    ]

    Plug.Test.conn(method, "/" <> query_string)
    |> assign(:config, config)
  end

  describe "DeleteShapePlug" do
    setup [:with_electric_instance_id, :with_tenant_id]

    test "returns 404 if shape deletion is not allowed", ctx do
      conn =
        ctx
        |> conn("DELETE", "?root_table=.invalid_shape", false)
        |> DeleteShapePlug.call([])

      assert conn.status == 404

      assert Jason.decode!(conn.resp_body) == %{
               "status" => "Not found"
             }
    end

    test "returns 400 for invalid params", ctx do
      conn =
        ctx
        |> conn("DELETE", "?root_table=.invalid_shape")
        |> DeleteShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "root_table" => [
                 "invalid name syntax"
               ]
             }
    end

    test "should clean shape based on shape definition", ctx do
      Mock.ShapeCache
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts -> {@test_shape_id, 0} end)
      |> expect(:clean_shape, fn @test_shape_id, _ -> :ok end)

      conn =
        ctx
        |> conn(:delete, "?root_table=public.users")
        |> DeleteShapePlug.call([])

      assert conn.status == 202
    end

    test "should clean shape based on shape_id", ctx do
      Mock.ShapeCache
      |> expect(:clean_shape, fn @test_shape_id, _ -> :ok end)

      conn =
        ctx
        |> conn(:delete, "?root_table=public.users&shape_id=#{@test_shape_id}")
        |> DeleteShapePlug.call([])

      assert conn.status == 202
    end
  end
end
