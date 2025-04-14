defmodule Electric.Plug.DeleteShapePlugTest do
  use ExUnit.Case, async: true

  alias Electric.Plug.DeleteShapePlug
  alias Electric.Shapes.Shape

  import Support.ComponentSetup
  import Support.TestUtils, only: [set_status_to_active: 1]
  alias Support.Mock

  import Mox

  setup :verify_on_exit!
  @moduletag :capture_log

  @registry Registry.DeleteShapePlugTest

  @test_shape %Shape{
    root_table: {"public", "users"},
    root_table_id: :erlang.phash2({"public", "users"}),
    root_pk: ["id"],
    root_column_count: 1,
    selected_columns: ["id"],
    flags: %{selects_all_columns: true}
  }
  @test_shape_handle "test-shape-handle"
  @test_pg_id "12345"

  def load_column_info({"public", "users"}, _),
    do:
      {:ok, [%{name: "id", type: "int8", pk_position: 0, type_id: {20, -1}, is_generated: false}]}

  def load_relation(tbl, _),
    do: Support.StubInspector.load_relation(tbl, nil)

  def conn(_ctx, method, "?" <> _ = query_string) do
    Plug.Test.conn(method, "/" <> query_string)
  end

  def call_delete_shape_plug(conn, ctx, allow \\ true) do
    config =
      Electric.Shapes.Api.plug_opts(
        stack_id: ctx.stack_id,
        stack_events_registry: Electric.stack_events_registry(),
        stack_ready_timeout: 100,
        pg_id: @test_pg_id,
        shape_cache: {Mock.ShapeCache, []},
        storage: {Mock.Storage, []},
        inspector: {__MODULE__, []},
        registry: @registry,
        long_poll_timeout: Access.get(ctx, :long_poll_timeout, 20_000),
        max_age: Access.get(ctx, :max_age, 60),
        stale_age: Access.get(ctx, :stale_age, 300),
        allow_shape_deletion: allow,
        persistent_kv: ctx.persistent_kv
      )

    DeleteShapePlug.call(conn, config)
  end

  setup :with_persistent_kv

  describe "DeleteShapePlug" do
    setup [:with_stack_id_from_test, :with_status_monitor]

    setup ctx do
      start_link_supervised!({Registry, keys: :duplicate, name: @registry})

      {:via, _, {registry_name, registry_key}} =
        Electric.Replication.Supervisor.name(ctx)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)
      set_status_to_active(ctx)

      :ok
    end

    test "returns 405 if shape deletion is not allowed", ctx do
      conn =
        ctx
        |> conn("DELETE", "?table=.invalid_shape")
        |> call_delete_shape_plug(ctx, false)

      assert conn.status == 405

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "DELETE not allowed"
             }
    end

    test "returns 400 for invalid table", ctx do
      conn =
        ctx
        |> conn("DELETE", "?table=.invalid_shape")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 400
      assert Plug.Conn.get_resp_header(conn, "cache-control") == ["no-cache"]

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "table" => [
                   "Invalid zero-length delimited identifier"
                 ]
               }
             }
    end

    test "returns 400 for invalid params", ctx do
      conn =
        ctx
        |> conn("DELETE", "?")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 400
      assert Plug.Conn.get_resp_header(conn, "cache-control") == ["no-cache"]

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "handle" => [
                   "can't be blank when shape definition is missing"
                 ]
               }
             }
    end

    test "should clean shape based on shape definition", ctx do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts -> {@test_shape_handle, 0} end)
      |> expect(:clean_shape, fn @test_shape_handle, _ -> :ok end)

      conn =
        ctx
        |> conn(:delete, "?table=public.users")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 202
      assert Plug.Conn.get_resp_header(conn, "cache-control") == ["no-cache"]
    end

    test "should clean shape based only on shape_handle", ctx do
      Mock.ShapeCache
      |> expect(:has_shape?, fn @test_shape_handle, _opts -> true end)
      |> expect(:clean_shape, fn @test_shape_handle, _ -> :ok end)

      conn =
        ctx
        |> conn(:delete, "?handle=#{@test_shape_handle}")
        |> call_delete_shape_plug(ctx)

      assert conn.status == 202
    end
  end

  describe "stack not ready" do
    setup [:with_stack_id_from_test, :with_status_monitor]

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
