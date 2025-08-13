defmodule BurnWeb.AuthController do
  use BurnWeb, :controller

  alias Burn.Accounts

  def sign_in(conn, %{"username" => username} = params) when is_binary(username) do
    avatar_url = Map.get(params, "avatar_url")

    {:ok, user} = Accounts.get_or_create_human_user(username, avatar_url)

    conn
    |> json(user)
  end

  def sign_in(conn, _params) do
    conn
    |> put_status(400)
    |> json(%{error: "Username is required"})
  end
end
