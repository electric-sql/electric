defmodule BurnWeb.PageControllerTest do
  use BurnWeb.ConnCase

  test "GET /", %{conn: conn} do
    conn = get(conn, ~p"/")

    assert html_response(conn, 200) =~ "<div id=\"root\"></div>"
  end
end
