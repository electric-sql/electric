defmodule ApiWeb.GatekeeperTest do
  use ApiWeb.ConnCase

  alias ApiWeb.Authenticator

  import Electric.Phoenix, only: [shape_from_params: 1]

  setup %{conn: conn} do
    {:ok, conn: put_req_header(conn, "accept", "application/json")}
  end

  describe "gatekeeper plug" do
    test "does not support GET requests", %{conn: conn} do
      assert conn
             |> get("/gatekeeper/items")
             |> response(404)
    end

    test "generates valid config", %{conn: conn} do
      data =
        conn
        |> post("/gatekeeper/items")
        |> json_response(200)

      assert %{"table" => "items"} = data
    end

    test "generates valid config with params", %{conn: conn} do
      clause = "value is not None"

      data =
        conn
        |> post("/gatekeeper/items", where: clause)
        |> json_response(200)

      assert %{"table" => "items", "where" => ^clause} = data
    end
  end

  describe "gatekeeper auth" do
    test "generates an auth header", %{conn: conn} do
      data =
        conn
        |> post("/gatekeeper/items")
        |> json_response(200)

      assert %{"headers" => %{"Authorization" => "Bearer " <> _token}} = data
    end

    test "generates a valid auth header", %{conn: conn} do
      assert %{"headers" => headers, "table" => table} =
               conn
               |> post("/gatekeeper/items")
               |> json_response(200)

      {:ok, shape} = shape_from_params(%{"table" => table})

      assert Authenticator.authorize(shape, headers)
    end
  end
end
