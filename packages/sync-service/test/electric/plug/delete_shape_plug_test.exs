defmodule Electric.Plug.DeleteShapePlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Plug.DeleteShapePlug
  alias Electric.Shapes.Shape

  import Mox
  setup :verify_on_exit!
  @moduletag :capture_log

  @registry Registry.DeleteShapePlugTest

  @test_shape %Shape{root_table: {"public", "users"}}
  @test_shape_id "test-shape-id"

  defmodule Inspector do
    def load_table_info({"public", "users"}, _), do: [%{name: "id", type: "int8"}]
  end

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  def conn(method, "?" <> _ = query_string, allow \\ true) do
    # Pass mock dependencies to the plug
    config = %{
      shape_cache: {Electric.ShapeCacheMock, []},
      inspector: {__MODULE__.Inspector, []},
      registry: @registry,
      long_poll_timeout: 20_000,
      max_age: 60,
      stale_age: 300,
      allow_shape_deletion: allow
    }

    Plug.Test.conn(method, "/" <> query_string)
    |> assign(:config, config)
  end

  describe "DeleteShapePlug" do
    test "returns 404 if shape deletion is not allowed" do
      conn =
        conn("DELETE", "?root_table=.invalid_shape", false)
        |> DeleteShapePlug.call([])

      assert conn.status == 404

      assert Jason.decode!(conn.resp_body) == %{
               "status" => "Not found"
             }
    end

    test "returns 400 for invalid params" do
      conn =
        conn("DELETE", "?root_table=.invalid_shape")
        |> DeleteShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "root_table" => ["table name does not match expected format"]
             }
    end

    test "should clean shape based on shape definition" do
      Electric.ShapeCacheMock
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts -> {@test_shape_id, 0} end)
      |> expect(:clean_shape, fn _, @test_shape_id -> :ok end)

      conn =
        conn(:delete, "?root_table=public.users")
        |> DeleteShapePlug.call([])

      assert conn.status == 204
    end

    test "should clean shape based on shape_id" do
      Electric.ShapeCacheMock
      |> expect(:clean_shape, fn _, @test_shape_id -> :ok end)

      conn =
        conn(:delete, "?root_table=public.users&shape_id=#{@test_shape_id}")
        |> DeleteShapePlug.call([])

      assert conn.status == 204
    end
  end
end
