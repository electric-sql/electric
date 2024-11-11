defmodule Api.Shape do
  require Protocol

  alias Electric.Client.ShapeDefinition

  @public_fields [:namespace, :table, :where, :columns]

  Protocol.derive(Jason.Encoder, ShapeDefinition, only: @public_fields)

  # Compare the `shape` derived from the request params with the shape params
  # signed in the auth token. Does the auth token grant access to this shape?
  def matches(%ShapeDefinition{} = request_shape, %ShapeDefinition{} = token_shape) do
    with ^token_shape <- request_shape do
      true
    else
      _alt ->
        false
    end
  end

  # Generate a `%ShapeDefinition{}` from a string keyed Map of `params`.
  def from(params) do
    with {table, other} when not is_nil(table) <- Map.pop(params, "table"),
         options <- Enum.reduce(other, [], &put/2) do
      ShapeDefinition.new(table, options)
    end
  end

  defp put({k, v}, opts) when is_binary(k) do
    put({String.to_existing_atom(k), v}, opts)
  end

  defp put({k, v}, opts) when k in @public_fields do
    Keyword.put(opts, k, v)
  end

  defp put(_, opts), do: opts
end
