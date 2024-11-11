defmodule ApiWeb.Plugs.Auth.AuthoriseShapeAccess do
  @moduledoc """
  This plug allows the dummy user to access any shape.

  In a real application, you would use this step to validate that the
  `user` has the right to access the `shape`. For example, you could
  perform a database lookup or call out to an external auth service.
  """
  use ApiWeb, :plug

  def init(opts), do: opts

  def call(%{assigns: %{current_user: user, shape: shape}} = conn, _opts) do
    case is_authorised(user, shape) do
      true ->
        conn

      false ->
        conn
        |> send_resp(403, "Forbidden")
        |> halt()
    end
  end

  defp is_authorised(:dummy, _) do
    true
  end

  defp is_authorised(_, _), do: false
end
