defmodule BurnWeb.ErrorJSONTest do
  use BurnWeb.ConnCase

  test "renders 404" do
    assert BurnWeb.ErrorJSON.render("404.json", %{}) == %{errors: %{detail: "Not Found"}}
  end

  test "renders 500" do
    assert BurnWeb.ErrorJSON.render("500.json", %{}) ==
             %{errors: %{detail: "Internal Server Error"}}
  end
end
