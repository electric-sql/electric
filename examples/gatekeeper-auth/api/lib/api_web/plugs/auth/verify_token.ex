defmodule ApiWeb.Plugs.Auth.VerifyToken do
  @moduledoc """
  Verify that the token matches the shape. We do this by comparing the
  shape defined in the request query params with the shape signed into
  the auth token claims.

  So you can't proxy a shape request without having a signed token for
  that exact shape definition.
  """
  use ApiWeb, :plug

  alias ApiWeb.Authenticator

  def init(opts), do: opts

  def call(%{assigns: %{shape: shape}, req_headers: header_list} = conn, _opts) do
    headers = Enum.into(header_list, %{})

    case Authenticator.authorise(shape, headers) do
      true ->
        conn

      _alt ->
        conn
        |> send_resp(403, "Forbidden")
        |> halt()
    end
  end
end
