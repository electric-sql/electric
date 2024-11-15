defmodule ApiWeb.IntegrationTest do
  use ApiWeb.ConnCase

  setup %{conn: conn} do
    {:ok, conn: put_req_header(conn, "accept", "application/json")}
  end

  describe "integration" do
    test "gatekeeper auth token works with the proxy", %{conn: conn} do
      # Define a shape. Any shape.
      table = "items"
      where = "value IS NOT NULL"

      # Fetch the client config from the gatekeeper endpoint.
      assert %{"headers" => %{"Authorization" => auth_header}} =
               conn
               |> post("/gatekeeper/#{table}", where: where)
               |> json_response(200)

      # Make an authorized shape request.
      assert [] =
               conn
               |> put_req_header("authorization", auth_header)
               |> get("/proxy/v1/shape", offset: -1, table: table, where: where)
               |> json_response(200)
    end

    test "using the gatekeeper config", %{conn: conn} do
      # As above but this time dynamically construct the proxy request
      # from the config returned by the gatekeeper endpoint.
      assert data =
               conn
               |> post("/gatekeeper/items", where: "value IS NOT NULL")
               |> json_response(200)

      assert {headers, data} = Map.pop(data, "headers")
      assert {url, shape_params} = Map.pop(data, "url")

      # We use the path, not the full URL just because we're testing.
      path = URI.parse(url).path
      params = Map.put(shape_params, "offset", -1)

      conn =
        headers
        |> Enum.reduce(conn, fn {k, v}, acc -> put_req_header(acc, String.downcase(k), v) end)
        |> get(path, params)

      assert [] = json_response(conn, 200)
    end
  end
end
