defmodule Electric.Client.TagTracker do
  @moduledoc """
  Manages tag tracking for move-out support in Electric shapes.

  This module handles tracking which keys have which tags, enabling the
  generation of synthetic delete messages when rows move out of a shape's
  subquery filter.

  ## Data Structures

  Two maps are maintained:
  - `tag_to_keys`: `%{tag_value => MapSet<key>}` - which keys have each tag
  - `key_data`: `%{key => %{tags: MapSet<tag>, msg: msg}}` - each key's current tags and latest message

  This allows:
  1. Avoiding duplicate entries when a row is updated (we update the msg, not add a new entry)
  2. Checking if a row still has other tags before generating a synthetic delete
  """

  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.Headers

  @type tag :: String.t()
  @type key :: String.t()
  @type tag_to_keys :: %{optional(tag()) => MapSet.t(key())}
  @type key_data :: %{optional(key()) => %{tags: MapSet.t(tag()), msg: ChangeMessage.t()}}

  @doc """
  Update the tag index when a change message is received.

  Returns `{updated_tag_to_keys, updated_key_data}`.
  """
  @spec update_tag_index(tag_to_keys(), key_data(), ChangeMessage.t()) ::
          {tag_to_keys(), key_data()}
  def update_tag_index(tag_to_keys, key_data, %ChangeMessage{headers: headers, key: key} = msg) do
    new_tags = headers.tags || []
    removed_tags = headers.removed_tags || []

    # Get current data for this key
    current_data = Map.get(key_data, key)
    current_tags = if current_data, do: current_data.tags, else: MapSet.new()

    # Calculate the new set of tags for this key
    updated_tags =
      current_tags
      |> MapSet.difference(MapSet.new(removed_tags))
      |> MapSet.union(MapSet.new(new_tags))

    # For deletes, remove the key entirely
    case headers.operation do
      :delete ->
        # Remove key from all its tags in tag_to_keys
        updated_tag_to_keys =
          Enum.reduce(updated_tags, tag_to_keys, fn tag, acc ->
            remove_key_from_tag(acc, tag, key)
          end)

        # Remove key from key_data
        {updated_tag_to_keys, Map.delete(key_data, key)}

      _ ->
        # If no tags (current or new), don't track this key
        if MapSet.size(updated_tags) == 0 do
          # Remove key from all its previous tags in tag_to_keys
          updated_tag_to_keys =
            Enum.reduce(current_tags, tag_to_keys, fn tag, acc ->
              remove_key_from_tag(acc, tag, key)
            end)

          # Remove key from key_data
          {updated_tag_to_keys, Map.delete(key_data, key)}
        else
          # Update tag_to_keys: remove from old tags, add to new tags
          tags_to_remove = MapSet.difference(current_tags, updated_tags)
          tags_to_add = MapSet.difference(updated_tags, current_tags)

          updated_tag_to_keys =
            tag_to_keys
            |> remove_key_from_tags(tags_to_remove, key)
            |> add_key_to_tags(tags_to_add, key)

          # Update key_data with new tags and latest message
          updated_key_data = Map.put(key_data, key, %{tags: updated_tags, msg: msg})

          {updated_tag_to_keys, updated_key_data}
        end
    end
  end

  @doc """
  Generate synthetic delete messages for keys matching move-out patterns.

  Returns `{synthetic_deletes, updated_tag_to_keys, updated_key_data}`.
  """
  @spec generate_synthetic_deletes(tag_to_keys(), key_data(), [map()], DateTime.t()) ::
          {[ChangeMessage.t()], tag_to_keys(), key_data()}
  def generate_synthetic_deletes(tag_to_keys, key_data, patterns, request_timestamp) do
    # Assumption: move-out patterns only include simple tag values; positional matching
    # for composite tags is not needed with the current server behavior.

    # First pass: collect all keys that match any pattern and remove those tags
    {matched_keys_with_tags, updated_tag_to_keys} =
      Enum.reduce(patterns, {%{}, tag_to_keys}, fn %{value: tag_value}, {keys_acc, ttk_acc} ->
        case Map.pop(ttk_acc, tag_value) do
          {nil, ttk_acc} ->
            {keys_acc, ttk_acc}

          {keys_in_tag, ttk_acc} ->
            # Track which tags were removed for each key
            updated_keys_acc =
              Enum.reduce(keys_in_tag, keys_acc, fn key, acc ->
                removed_tags = Map.get(acc, key, MapSet.new())
                Map.put(acc, key, MapSet.put(removed_tags, tag_value))
              end)

            {updated_keys_acc, ttk_acc}
        end
      end)

    # Second pass: for each matched key, update its tags and check if it should be deleted
    {keys_to_delete, updated_key_data} =
      Enum.reduce(matched_keys_with_tags, {[], key_data}, fn {key, removed_tags},
                                                             {deletes, kd_acc} ->
        case Map.get(kd_acc, key) do
          nil ->
            {deletes, kd_acc}

          %{tags: current_tags, msg: msg} ->
            remaining_tags = MapSet.difference(current_tags, removed_tags)

            if MapSet.size(remaining_tags) == 0 do
              # No remaining tags - key should be deleted
              {[{key, msg} | deletes], Map.delete(kd_acc, key)}
            else
              # Still has other tags - update key_data but don't delete
              {deletes, Map.put(kd_acc, key, %{tags: remaining_tags, msg: msg})}
            end
        end
      end)

    # Generate synthetic delete messages
    synthetic_deletes =
      Enum.map(keys_to_delete, fn {key, original_msg} ->
        %ChangeMessage{
          key: key,
          value: original_msg.value,
          old_value: nil,
          headers:
            Headers.delete(
              relation: original_msg.headers.relation,
              handle: original_msg.headers.handle
            ),
          request_timestamp: request_timestamp
        }
      end)

    {synthetic_deletes, updated_tag_to_keys, updated_key_data}
  end

  # Private helpers

  defp remove_key_from_tags(tag_to_keys, tags, key) do
    Enum.reduce(tags, tag_to_keys, fn tag, acc ->
      remove_key_from_tag(acc, tag, key)
    end)
  end

  defp remove_key_from_tag(tag_to_keys, tag, key) do
    case Map.get(tag_to_keys, tag) do
      nil ->
        tag_to_keys

      keys ->
        updated_keys = MapSet.delete(keys, key)

        if MapSet.size(updated_keys) == 0 do
          Map.delete(tag_to_keys, tag)
        else
          Map.put(tag_to_keys, tag, updated_keys)
        end
    end
  end

  defp add_key_to_tags(tag_to_keys, tags, key) do
    Enum.reduce(tags, tag_to_keys, fn tag, acc ->
      keys = Map.get(acc, tag, MapSet.new())
      Map.put(acc, tag, MapSet.put(keys, key))
    end)
  end
end
