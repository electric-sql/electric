defmodule BurnWeb.AuthControllerTest do
  use BurnWeb.ConnCase

  import Burn.AccountsFixtures

  setup do
    %{user: user_fixture()}
  end

  describe "POST /auth/sign-in" do
    test "requires username", %{conn: conn} do
      conn =
        conn
        |> post(~p"/auth/sign-in", %{})

      assert %{"error" => "Username is required"} = json_response(conn, 400)
    end

    test "signs in existing user", %{conn: conn, user: %{id: user_id, name: user_name}} do
      conn =
        conn
        |> post(~p"/auth/sign-in", %{"username" => user_name})

      assert %{"id" => ^user_id} = json_response(conn, 200)
    end

    test "creates new user", %{conn: conn} do
      conn =
        conn
        |> post(~p"/auth/sign-in", %{"username" => "new_user"})

      assert %{"name" => "new_user"} = json_response(conn, 200)
    end
  end
end
