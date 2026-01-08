defmodule Electric.Client.MoveState do
  @moduledoc """
  Tracks tag state for rows in a shape with subqueries.

  When a shape has a subquery in its WHERE clause, each row receives tags
  explaining why it's included in the shape. This module tracks those tags
  and handles move-out events that remove rows when their tags are exhausted.

  ## Overview

  - Each row can have multiple tags (e.g., when it matches multiple subquery results)
  - Move-out patterns specify which tags to remove based on position and value
  - When a row's tag set becomes empty, it should be deleted from the client

  ## Example

      iex> state = MoveState.new()
      iex> state = MoveState.add_tags_to_row(state, "row1", ["abc123", "def456"])
      iex> {rows_to_delete, state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "abc123"})
      iex> rows_to_delete
      []  # row1 still has "def456"
      iex> {rows_to_delete, state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "def456"})
      iex> rows_to_delete
      ["row1"]  # row1 has no more tags
  """

  alias Electric.Client.TagIndex

  @type row_key :: String.t()
  @type move_tag :: String.t()

  @type t :: %__MODULE__{
          row_tags: %{row_key() => MapSet.t(move_tag())},
          tag_index: TagIndex.t(),
          tag_cache: %{move_tag() => TagIndex.parsed_tag()},
          has_tags?: boolean()
        }

  defstruct row_tags: %{},
            tag_index: TagIndex.new(),
            tag_cache: %{},
            has_tags?: false

  @doc """
  Create a new empty move state.
  """
  @spec new() :: t()
  def new do
    %__MODULE__{}
  end

  @doc """
  Add tags to a row.

  If the row doesn't exist, it's created. Tags are added to both the row's
  tag set and the positional index.

  Returns the updated state.
  """
  @spec add_tags_to_row(t(), row_key(), [move_tag()]) :: t()
  def add_tags_to_row(%__MODULE__{} = state, _row_key, []), do: state

  def add_tags_to_row(%__MODULE__{} = state, row_key, tags) when is_list(tags) do
    Enum.reduce(tags, state, fn tag, state ->
      add_tag_to_row(state, row_key, tag)
    end)
  end

  defp add_tag_to_row(state, row_key, tag) do
    # Get or create row's tag set
    row_tag_set = Map.get(state.row_tags, row_key, MapSet.new())

    if MapSet.member?(row_tag_set, tag) do
      # Tag already exists for this row
      state
    else
      # Parse and cache the tag
      {parsed_tag, tag_cache} = parse_and_cache(state.tag_cache, tag)

      # Add to row's tag set
      row_tags = Map.put(state.row_tags, row_key, MapSet.put(row_tag_set, tag))

      # Add to positional index
      tag_index = TagIndex.add_parsed_tag(state.tag_index, row_key, parsed_tag)

      %{state | row_tags: row_tags, tag_index: tag_index, tag_cache: tag_cache, has_tags?: true}
    end
  end

  @doc """
  Remove specific tags from a row.

  If the row doesn't exist or doesn't have the specified tags, this is a no-op.

  Returns the updated state.
  """
  @spec remove_tags_from_row(t(), row_key(), [move_tag()]) :: t()
  def remove_tags_from_row(%__MODULE__{} = state, _row_key, []), do: state

  def remove_tags_from_row(%__MODULE__{} = state, row_key, tags) when is_list(tags) do
    Enum.reduce(tags, state, fn tag, state ->
      remove_tag_from_row(state, row_key, tag)
    end)
  end

  defp remove_tag_from_row(state, row_key, tag) do
    case Map.get(state.row_tags, row_key) do
      nil ->
        state

      row_tag_set ->
        if MapSet.member?(row_tag_set, tag) do
          # Parse tag (may be cached)
          {parsed_tag, tag_cache} = parse_and_cache(state.tag_cache, tag)

          # Remove from row's tag set
          new_tag_set = MapSet.delete(row_tag_set, tag)

          row_tags =
            if MapSet.size(new_tag_set) == 0 do
              Map.delete(state.row_tags, row_key)
            else
              Map.put(state.row_tags, row_key, new_tag_set)
            end

          # Remove from positional index
          tag_index = TagIndex.remove_parsed_tag(state.tag_index, row_key, parsed_tag)

          # Remove from cache if no longer needed
          tag_cache = maybe_remove_from_cache(tag_cache, tag, row_tags)

          %{state | row_tags: row_tags, tag_index: tag_index, tag_cache: tag_cache}
        else
          state
        end
    end
  end

  @doc """
  Clear all tags for a row.

  Called when a row is deleted. Removes all tag associations for the row.

  Returns the updated state.
  """
  @spec clear_row(t(), row_key()) :: t()
  def clear_row(%__MODULE__{} = state, row_key) do
    case Map.get(state.row_tags, row_key) do
      nil ->
        state

      row_tag_set ->
        # Remove all tags from the index
        {tag_index, tag_cache} =
          Enum.reduce(row_tag_set, {state.tag_index, state.tag_cache}, fn tag, {index, cache} ->
            {parsed_tag, cache} = parse_and_cache(cache, tag)
            index = TagIndex.remove_parsed_tag(index, row_key, parsed_tag)
            {index, cache}
          end)

        # Remove row from row_tags
        row_tags = Map.delete(state.row_tags, row_key)

        # Clean up cache
        tag_cache =
          Enum.reduce(row_tag_set, tag_cache, fn tag, cache ->
            maybe_remove_from_cache(cache, tag, row_tags)
          end)

        %{state | row_tags: row_tags, tag_index: tag_index, tag_cache: tag_cache}
    end
  end

  @doc """
  Process a move-out pattern.

  Finds all rows matching the pattern, removes matching tags from each,
  and returns the list of rows that should be deleted (those with empty tag sets).

  Returns `{rows_to_delete, updated_state}`.
  """
  @spec process_move_out_pattern(t(), TagIndex.move_out_pattern()) :: {[row_key()], t()}
  def process_move_out_pattern(%__MODULE__{has_tags?: false} = state, _pattern) do
    {[], state}
  end

  def process_move_out_pattern(%__MODULE__{} = state, %{pos: _, value: _} = pattern) do
    # Find all rows that have a tag with this value at this position
    affected_rows = TagIndex.find_rows_matching_pattern(state.tag_index, pattern)

    # Process each affected row
    {rows_to_delete, state} =
      Enum.reduce(affected_rows, {[], state}, fn row_key, {deletes, state} ->
        {should_delete, state} = remove_matching_tags_from_row(state, row_key, pattern)

        if should_delete do
          {[row_key | deletes], state}
        else
          {deletes, state}
        end
      end)

    {rows_to_delete, state}
  end

  defp remove_matching_tags_from_row(state, row_key, pattern) do
    case Map.get(state.row_tags, row_key) do
      nil ->
        {false, state}

      row_tag_set ->
        # Find and remove all tags that match this pattern
        {tags_to_remove, tag_cache} =
          Enum.reduce(row_tag_set, {[], state.tag_cache}, fn tag, {to_remove, cache} ->
            {parsed_tag, cache} = parse_and_cache(cache, tag)

            if TagIndex.tag_matches_pattern?(parsed_tag, pattern) do
              {[{tag, parsed_tag} | to_remove], cache}
            else
              {to_remove, cache}
            end
          end)

        # Remove matching tags
        {new_tag_set, tag_index} =
          Enum.reduce(tags_to_remove, {row_tag_set, state.tag_index}, fn {tag, parsed_tag},
                                                                         {tag_set, index} ->
            tag_set = MapSet.delete(tag_set, tag)
            index = TagIndex.remove_parsed_tag(index, row_key, parsed_tag)
            {tag_set, index}
          end)

        # Update row_tags
        row_tags =
          if MapSet.size(new_tag_set) == 0 do
            Map.delete(state.row_tags, row_key)
          else
            Map.put(state.row_tags, row_key, new_tag_set)
          end

        # Clean up cache for removed tags
        tag_cache =
          Enum.reduce(tags_to_remove, tag_cache, fn {tag, _}, cache ->
            maybe_remove_from_cache(cache, tag, row_tags)
          end)

        state = %{state | row_tags: row_tags, tag_index: tag_index, tag_cache: tag_cache}

        # Return whether this row should be deleted
        {MapSet.size(new_tag_set) == 0, state}
    end
  end

  @doc """
  Check if a row has any remaining tags.
  """
  @spec row_has_tags?(t(), row_key()) :: boolean()
  def row_has_tags?(%__MODULE__{row_tags: row_tags}, row_key) do
    case Map.get(row_tags, row_key) do
      nil -> false
      tag_set -> MapSet.size(tag_set) > 0
    end
  end

  @doc """
  Get all tags for a row.

  Returns an empty MapSet if the row has no tags.
  """
  @spec get_row_tags(t(), row_key()) :: MapSet.t(move_tag())
  def get_row_tags(%__MODULE__{row_tags: row_tags}, row_key) do
    Map.get(row_tags, row_key, MapSet.new())
  end

  @doc """
  Reset all state.

  Called on must-refetch to clear all tracking.
  """
  @spec reset(t()) :: t()
  def reset(%__MODULE__{}) do
    new()
  end

  @doc """
  Check if move state has any tags tracked.
  """
  @spec has_tags?(t()) :: boolean()
  def has_tags?(%__MODULE__{has_tags?: has_tags?}), do: has_tags?

  # Parse a tag and cache the result
  defp parse_and_cache(cache, tag) do
    case Map.get(cache, tag) do
      nil ->
        parsed = TagIndex.parse_tag(tag)
        {parsed, Map.put(cache, tag, parsed)}

      parsed ->
        {parsed, cache}
    end
  end

  # Remove a tag from cache if no rows use it anymore
  defp maybe_remove_from_cache(cache, tag, row_tags) do
    # Check if any row still has this tag
    still_used =
      Enum.any?(row_tags, fn {_row_key, tag_set} ->
        MapSet.member?(tag_set, tag)
      end)

    if still_used do
      cache
    else
      Map.delete(cache, tag)
    end
  end
end
