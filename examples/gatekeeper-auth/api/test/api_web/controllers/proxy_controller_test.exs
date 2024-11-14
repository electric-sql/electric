defmodule ApiWeb.ProxyControllerTest do
  use ApiWeb.ConnCase

  alias Api.Token
  alias Electric.Client.ShapeDefinition

  setup %{conn: conn} do
    {:ok, conn: put_req_header(conn, "accept", "application/json")}
  end

  describe "show" do
    test "requires shape params", %{conn: conn} do
      assert conn
             |> get("/proxy/v1/shape")
             |> response(400)
    end

    test "requires auth", %{conn: conn} do
      assert conn
             |> get("/proxy/v1/shape", table: "items")
             |> response(401)
    end

    test "requires valid auth header", %{conn: conn} do
      assert conn
             |> put_req_header("authorization", "Bearer invalid-token")
             |> get("/proxy/v1/shape", table: "items")
             |> response(401)
    end

    test "requires matching shape definition", %{conn: conn} do
      {:ok, shape} = ShapeDefinition.new("wrong", [])

      assert conn
             |> put_req_header("authorization", "Bearer #{Token.generate(shape)}")
             |> get("/proxy/v1/shape", table: "items", offset: -1)
             |> response(403)
    end

    test "proxies request", %{conn: conn} do
      {:ok, shape} = ShapeDefinition.new("items", [])

      assert conn
             |> put_req_header("authorization", "Bearer #{Token.generate(shape)}")
             |> get("/proxy/v1/shape", table: "items", offset: -1)
             |> json_response(200)
    end
  end
end
