defmodule ApiWeb.Plugs.Auth.VerifyToken do
  @moduledoc """
  Verify that the auth token in the Authorization header matches the shape.

  We do this by comparing the shape defined in the request query params with
  the shape signed into the auth token claims.

  So you can't proxy a shape request without having a signed token for
  that exact shape definition.
  """
  use ApiWeb, :plug

  alias ApiWeb.Authenticator

  def init(opts), do: opts

  def call(%{assigns: %{shape: shape}, req_headers: headers} = conn, _opts) do
    case Authenticator.authorize(shape, headers) do
      {:error, message} when message in [:invalid, :missing] ->
        conn
        |> send_resp(401, "Unauthorized")
        |> halt()

      false ->
        conn
        |> send_resp(403, "Forbidden")
        |> halt()

      true ->
        conn
    end
  end
end
