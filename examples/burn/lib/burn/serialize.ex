defimpl String.Chars, for: Map do
  def to_string(map) do
    Jason.encode!(map)
  end
end
