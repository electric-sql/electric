defmodule Electric.Client.Authenticator.MockAuthenticator do
  @moduledoc """
  A pseudo-authenticating `Electric.Client.Authenticator` implementation.

  This generates fake authentication headers, useful for validating that the
  `Authenticator` behaviour is being called correctly.
  """

  @behaviour Electric.Client.Authenticator

  @joiner "\n"
  @header "electric-mock-auth"

  def authenticate_request(request, config) do
    put_request_params(request, shape_hash(request.shape, config))
  end

  def authenticate_shape(shape, config) do
    shape
    |> shape_hash(config)
    |> auth_headers()
  end

  defp shape_hash(shape, config) do
    auth_hash([:namespace, :table, :columns, :where], shape, config)
  end

  defp put_request_params(request, hash) do
    Map.update!(%{request | authenticated: true}, :headers, &auth_headers(&1, hash))
  end

  defp auth_headers(base \\ %{}, hash) do
    Map.put(base, @header, hash)
  end

  defp auth_hash(keys, struct, config) do
    keys
    |> Enum.map(&Map.fetch!(struct, &1))
    |> Enum.map(&to_string/1)
    |> Enum.concat(List.wrap(config[:salt]))
    |> Enum.join(@joiner)
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end
end
