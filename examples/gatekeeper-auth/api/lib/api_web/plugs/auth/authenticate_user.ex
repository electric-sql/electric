defmodule ApiWeb.Plugs.Auth.AuthenticateUser do
  @moduledoc """
  This plug is a no-op that just assigns a dummy user.

  In a real application, you would use this step to authenticate the user
  based on some credentials and assign the real user to the conn.
  """
  use ApiWeb, :plug

  def init(opts), do: opts

  def call(conn, _opts) do
    conn
    |> assign(:current_user, :dummy)
  end
end
