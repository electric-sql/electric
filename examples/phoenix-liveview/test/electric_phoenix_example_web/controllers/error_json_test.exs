defmodule Electric.PhoenixExampleWeb.ErrorJSONTest do
  use Electric.PhoenixExampleWeb.ConnCase, async: true

  test "renders 404" do
    assert Electric.PhoenixExampleWeb.ErrorJSON.render("404.json", %{}) == %{errors: %{detail: "Not Found"}}
  end

  test "renders 500" do
    assert Electric.PhoenixExampleWeb.ErrorJSON.render("500.json", %{}) ==
             %{errors: %{detail: "Internal Server Error"}}
  end
end
