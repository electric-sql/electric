defmodule BeerStarsWeb.WebhookJSONTest do
  use BeerStarsWeb.ConnCase, async: true

  test "status 200", %{conn: conn} do
    assert _resp =
      conn
      |> get("/_health")
      |> json_response(200)
  end
end
