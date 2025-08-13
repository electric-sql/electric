defmodule BurnWeb.AuthTest do
  use BurnWeb.ConnCase

  import Plug.Conn
  import Burn.AccountsFixtures

  alias BurnWeb.Auth

  setup do
    %{user: user_fixture()}
  end

  describe "fetch_api_user/2" do
    test "authenticates user from bearer token", %{conn: conn, user: %{id: user_id}} do
      conn =
        conn
        |> put_req_header("authorization", "Bearer #{user_id}")
        |> Auth.fetch_api_user([])

      assert conn.assigns.current_user.id == user_id
    end

    test "does not authenticate if user does not exist", %{conn: conn} do
      conn =
        conn
        |> put_req_header("authorization", "Unknown")
        |> Auth.fetch_api_user([])

      refute conn.assigns.current_user
    end

    test "does not authenticate if data is missing", %{conn: conn} do
      conn =
        conn
        |> Auth.fetch_api_user([])

      refute conn.assigns.current_user
    end
  end

  describe "require_authenticated_user/2" do
    test "passes through when user is authenticated", %{conn: conn, user: user} do
      conn =
        conn
        |> assign(:current_user, user)
        |> Auth.require_authenticated_user([])

      refute conn.status
      refute conn.halted
    end

    test "returns 401 when not authenticated", %{conn: conn} do
      conn =
        conn
        |> Auth.require_authenticated_user([])

      assert conn.status == 401
      assert conn.halted
    end
  end
end
