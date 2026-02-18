defmodule Electric.Client.ShapeKey do
  @moduledoc """
  Generate canonical shape keys for cache lookup.

  The canonical shape key is a stable identifier for a shape definition that
  excludes Electric protocol parameters (like cursor, handle, offset, etc.).
  This allows the client to identify when different requests are for the same
  underlying shape, which is useful for cache busting when CDN/proxy caches
  serve stale responses.
  """

  # Parameters that are part of the Electric protocol and should be excluded
  # from the canonical shape key
  @protocol_params ~w(
    cursor
    handle
    live
    offset
    cache-buster
    expired_handle
    log
    subset__where
    subset__limit
    subset__offset
    subset__order_by
    subset__params
    subset__where_expr
    subset__order_by_expr
  )

  @doc """
  Generate a canonical shape key from a URI.

  Extracts query parameters, filters out Electric protocol parameters,
  sorts the remaining parameters alphabetically, and returns a canonical
  URL string.

  ## Examples

      iex> uri = URI.parse("http://localhost:3000/v1/shape?table=items&cursor=123&offset=0_0")
      iex> ShapeKey.canonical(uri)
      "http://localhost:3000/v1/shape?table=items"

  """
  @spec canonical(URI.t()) :: String.t()
  def canonical(%URI{} = uri) do
    params = URI.decode_query(uri.query || "")
    canonical(uri, params)
  end

  @doc """
  Generate a canonical shape key from an endpoint URI and params map.

  ## Examples

      iex> endpoint = URI.parse("http://localhost:3000/v1/shape")
      iex> params = %{"table" => "items", "where" => "id > 0", "offset" => "0_0"}
      iex> ShapeKey.canonical(endpoint, params)
      "http://localhost:3000/v1/shape?table=items&where=id%20%3E%200"

  """
  @spec canonical(URI.t(), map()) :: String.t()
  def canonical(%URI{} = endpoint, params) when is_map(params) do
    # Filter out protocol parameters
    shape_params =
      params
      |> Enum.reject(fn {key, _value} -> key in @protocol_params end)
      |> Enum.sort_by(fn {key, _value} -> key end)

    # Build the canonical URL
    query =
      if shape_params == [] do
        nil
      else
        URI.encode_query(shape_params, :rfc3986)
      end

    %{endpoint | query: query}
    |> URI.to_string()
  end
end
