defmodule ApiWeb.Authenticator do
  @moduledoc """
  Functions for that generating and validating tokens.
  """

  alias Api.Token

  @header_name "Authorization"

  # We configure our `Electric.Phoenix.Plug` handler with this function as the
  # `authenticator` function in order to return a signed token to the client.
  def authentication_headers(_conn, shape) do
    %{@header_name => "Bearer #{Token.generate(shape)}"}
  end

  def authorize(shape, request_headers) do
    header_map = Enum.into(request_headers, %{})
    header_key = String.downcase(@header_name)

    with {:ok, "Bearer " <> token} <- Map.fetch(header_map, header_key) do
      Token.verify(shape, token)
    else
      _alt ->
        {:error, :missing}
    end
  end
end
