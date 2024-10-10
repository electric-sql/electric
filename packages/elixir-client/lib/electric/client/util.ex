defmodule Electric.Client.Util do
  @moduledoc false

  @doc """
  Generate a random string. The string is twice the length of the number of
  bytes.
  """
  @spec generate_id(integer()) :: String.t()
  def generate_id(num_bytes \\ 10) do
    :crypto.strong_rand_bytes(num_bytes)
    |> Base.encode16(case: :lower)
  end

  @doc """
  Conditional map put.

      iex> map_put_if(%{}, :a, 1, true)
      %{a: 1}

      iex> map_put_if(%{a: 1}, :a, 2, false)
      %{a: 1}

      iex> map_put_if(%{a: 1}, :a, 2, true)
      %{a: 2}
  """
  def map_put_if(map, key, value, true) do
    Map.put(map, key, value)
  end

  def map_put_if(map, _key, _value, _condition) do
    map
  end
end
