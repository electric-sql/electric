defmodule Electric.Plug.OptionsShapePlugTest do
  use ExUnit.Case, async: true

  alias Electric.Plug.OptionsShapePlug

  @registry Registry.OptionsShapePlugTest

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  describe "OptionsShapePlug" do
    test "returns relevant headers" do
      conn =
        Plug.Test.conn("OPTIONS", "/?root_table=foo")
        |> OptionsShapePlug.call([])

      assert conn.status == 204

      assert Plug.Conn.get_resp_header(conn, "access-control-max-age") == ["86400"]
      assert Plug.Conn.get_resp_header(conn, "connection") == ["keep-alive"]
    end

    test "omits the connection header on HTTP/2" do
      conn =
        Plug.Test.conn("OPTIONS", "/?root_table=foo")
        |> Plug.Test.put_http_protocol(:"HTTP/2")
        |> OptionsShapePlug.call([])

      assert conn.status == 204
      assert Plug.Conn.get_resp_header(conn, "access-control-max-age") == ["86400"]
      assert Plug.Conn.get_resp_header(conn, "connection") == []
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
  end
end
