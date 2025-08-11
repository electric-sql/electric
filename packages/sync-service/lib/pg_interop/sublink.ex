defmodule PgInterop.Sublink do
  def member?(value, list) when is_list(list) do
    Enum.member?(list, value)
  end

  def member?(value, %MapSet{} = set) do
    MapSet.member?(set, value)
  end
end
