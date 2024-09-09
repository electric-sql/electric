defmodule Electric.Plug.OptionsShapePlugTest do
  use ExUnit.Case, async: true

  alias Electric.Plug.OptionsShapePlug

  @registry Registry.OptionsShapePlugTest
  @expected_allowed_methods MapSet.new(["GET", "OPTIONS", "DELETE"])

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  describe "OptionsShapePlug" do
    test "returns allowed methods" do
      conn =
        Plug.Test.conn("OPTIONS", "/?root_table=foo")
        |> OptionsShapePlug.call([])

      assert conn.status == 204

      allowed_methods =
        conn
        |> Plug.Conn.get_resp_header("access-control-allow-methods")
        |> List.first("")
        |> String.split(",")
        |> Enum.map(&String.trim/1)
        |> MapSet.new()

      assert allowed_methods == @expected_allowed_methods
      assert Plug.Conn.get_resp_header(conn, "access-control-max-age") == ["86400"]
      assert Plug.Conn.get_resp_header(conn, "connection") == ["keep-alive"]
    end

    test "handles access-control-request-headers" do
      header = "If-None-Match"

      conn =
        Plug.Test.conn("OPTIONS", "/?root_table=foo")
        |> Plug.Conn.put_req_header("access-control-request-headers", header)
        |> OptionsShapePlug.call([])

      assert conn.status == 204
      assert Plug.Conn.get_resp_header(conn, "access-control-allow-headers") == [header]
    end

    test "handles origin header" do
      origin = "https://example.com"

      conn =
        Plug.Test.conn("OPTIONS", "/?root_table=foo")
        # also checks that it is case insensitive
        |> Plug.Conn.put_req_header("origin", origin)
        |> OptionsShapePlug.call([])

      assert conn.status == 204
      assert Plug.Conn.get_resp_header(conn, "access-control-allow-origin") == [origin]
    end
  end
end
