defmodule Electric.Shapes.Consumer.MoveDetector do
  @moduledoc """
  Tracks move tags for rows and detects move-in/move-out events.

  This module maintains an index of which rows have which tag values,
  allowing it to efficiently determine when a value moves in (first row
  with that value) or moves out (last row with that value deleted/updated).

  The tag_indices structure is:
  %{
    tag_value => MapSet.new([row_key1, row_key2, ...])
  }
  """

  @type tag_value :: term()
  @type row_key :: String.t()
  @type tag_indices :: %{tag_value() => MapSet.t(row_key())}
  @type move_tags :: list(list(term()))

  @doc """
  Creates a new empty move detector.
  """
  @spec new() :: tag_indices()
  def new, do: %{}

  @doc """
  Adds move tags for a row to the indices.

  For now, we only support one move tag per row (no `OR`s in the where clause if there's a subquery).
  """
  @spec add_row(tag_indices(), row_key(), move_tags()) :: tag_indices()
  def add_row(tag_indices, key, move_tags) do
    Enum.reduce(move_tags, tag_indices, fn [val1], acc ->
      Map.update(acc, val1, MapSet.new([key]), &MapSet.put(&1, key))
    end)
  end

  @doc """
  Removes move tags for a row from the indices.
  """
  @spec remove_row(tag_indices(), row_key(), move_tags()) :: tag_indices()
  def remove_row(tag_indices, key, move_tags) do
    Enum.reduce(move_tags, tag_indices, fn [val1], acc ->
      case Map.fetch(acc, val1) do
        {:ok, keys} ->
          new_keys = MapSet.delete(keys, key)

          if MapSet.size(new_keys) == 0 do
            Map.delete(acc, val1)
          else
            Map.put(acc, val1, new_keys)
          end

        :error ->
          acc
      end
    end)
  end

  @doc """
  Removes all rows with the given tag patterns from the indices.

  Returns {removed_keys, updated_indices}
  """
  @spec pop_keys(tag_indices(), list(list(term()))) :: {MapSet.t(row_key()), tag_indices()}
  def pop_keys(tag_indices, patterns) do
    # This implementation is naive while we support only one tag per row and no composite tags.
    Enum.reduce(patterns, {MapSet.new(), tag_indices}, fn [val1], {keys, acc} ->
      case Map.pop(acc, val1) do
        {nil, acc} -> {keys, acc}
        {v, acc} -> {MapSet.union(keys, v), acc}
      end
    end)
  end
end
