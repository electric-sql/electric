defmodule Electric.Client.TagTracker do
  @moduledoc """
  Manages tag tracking for move-out support in Electric shapes.

  This module handles tracking which keys have which tags, enabling the
  generation of synthetic delete messages when rows move out of a shape's
  subquery filter.

  ## Data Structures

  Three structures are maintained:
  - `tag_to_keys`: `%{{position, hash} => MapSet<key>}` - which keys have each position-hash pair
  - `key_data`: `%{key => %{tags: MapSet<{pos, hash}>, active_conditions: [boolean()] | nil, msg: msg}}` - each key's current state
  - `disjunct_positions`: `[[integer()]] | nil` - shared across all keys, derived once from the first tagged message

  Tags arrive as slash-delimited strings per disjunct (e.g., `"hash1/hash2/"`, `"//hash3"`).
  They are normalized into 2D arrays and indexed by `{position, hash_value}` tuples.

  For shapes with `active_conditions`, visibility is evaluated using DNF (Disjunctive Normal Form):
  a row is visible if at least one disjunct is satisfied (OR of ANDs over positions).
  """

  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.Headers

  @type position_hash :: {non_neg_integer(), String.t()}
  @type key :: String.t()
  @type tag_to_keys :: %{optional(position_hash()) => MapSet.t(key())}
  @type key_data :: %{
          optional(key()) => %{
            tags: MapSet.t(position_hash()),
            active_conditions: [boolean()] | nil,
            msg: ChangeMessage.t()
          }
        }
  @type disjunct_positions :: [[non_neg_integer()]] | nil

  @doc """
  Update the tag index when a change message is received.

  Tags are normalized from slash-delimited wire format to position-indexed entries.
  `disjunct_positions` is derived once from the first tagged message and reused for all
  subsequent messages, since it is determined by the shape's WHERE clause structure.

  Returns `{updated_tag_to_keys, updated_key_data, disjunct_positions}`.
  """
  @spec update_tag_index(tag_to_keys(), key_data(), disjunct_positions(), ChangeMessage.t()) ::
          {tag_to_keys(), key_data(), disjunct_positions()}
  def update_tag_index(
        tag_to_keys,
        key_data,
        disjunct_positions,
        %ChangeMessage{headers: headers, key: key} = msg
      ) do
    raw_new_tags = headers.tags || []
    raw_removed_tags = headers.removed_tags || []

    active_conditions =
      case headers.active_conditions do
        [] -> nil
        nil -> nil
        ac -> ac
      end

    # Normalize tags to 2D arrays
    normalized_new = normalize_tags(raw_new_tags)
    normalized_removed = normalize_tags(raw_removed_tags)

    # Extract position-hash entries
    new_entries = extract_position_entries(normalized_new)
    removed_entries = extract_position_entries(normalized_removed)

    # Get current data for this key
    current_data = Map.get(key_data, key)
    current_entries = if current_data, do: current_data.tags, else: MapSet.new()

    # Calculate updated entries
    updated_entries =
      current_entries
      |> MapSet.difference(removed_entries)
      |> MapSet.union(new_entries)

    # Derive disjunct positions once from the first tagged message
    disjunct_positions =
      case disjunct_positions do
        nil ->
          case derive_disjunct_positions(normalized_new) do
            [] -> nil
            positions -> positions
          end

        already_set ->
          already_set
      end

    case headers.operation do
      :delete ->
        # Remove key from all its entries in tag_to_keys
        updated_tag_to_keys =
          Enum.reduce(updated_entries, tag_to_keys, fn entry, acc ->
            remove_key_from_tag(acc, entry, key)
          end)

        {updated_tag_to_keys, Map.delete(key_data, key), disjunct_positions}

      _ ->
        if MapSet.size(updated_entries) == 0 do
          # No entries - remove key from tracking
          updated_tag_to_keys =
            Enum.reduce(current_entries, tag_to_keys, fn entry, acc ->
              remove_key_from_tag(acc, entry, key)
            end)

          {updated_tag_to_keys, Map.delete(key_data, key), disjunct_positions}
        else
          # Update tag_to_keys: remove old entries, add new entries
          entries_to_remove = MapSet.difference(current_entries, updated_entries)
          entries_to_add = MapSet.difference(updated_entries, current_entries)

          updated_tag_to_keys =
            tag_to_keys
            |> remove_key_from_tags(entries_to_remove, key)
            |> add_key_to_tags(entries_to_add, key)

          updated_key_data =
            Map.put(key_data, key, %{
              tags: updated_entries,
              active_conditions: active_conditions,
              msg: msg
            })

          {updated_tag_to_keys, updated_key_data, disjunct_positions}
        end
    end
  end

  @doc """
  Generate synthetic delete messages for keys matching move-out patterns.

  Patterns contain `%{pos: position, value: hash}` maps. For keys with
  `active_conditions`, positions are deactivated and visibility is re-evaluated
  using DNF with the shared `disjunct_positions`. For keys without
  `active_conditions`, the old behavior applies: delete when no entries remain.

  Returns `{synthetic_deletes, updated_tag_to_keys, updated_key_data}`.
  """
  @spec generate_synthetic_deletes(
          tag_to_keys(),
          key_data(),
          disjunct_positions(),
          [map()],
          DateTime.t()
        ) ::
          {[ChangeMessage.t()], tag_to_keys(), key_data()}
  def generate_synthetic_deletes(
        tag_to_keys,
        key_data,
        disjunct_positions,
        patterns,
        request_timestamp
      ) do
    # First pass: collect all keys that match any pattern (without modifying tag_to_keys)
    matched_keys_with_entries =
      Enum.reduce(patterns, %{}, fn %{pos: pos, value: value}, keys_acc ->
        tag_key = {pos, value}

        case Map.get(tag_to_keys, tag_key) do
          nil ->
            keys_acc

          keys_in_tag ->
            Enum.reduce(keys_in_tag, keys_acc, fn key, acc ->
              Map.update(acc, key, MapSet.new([tag_key]), &MapSet.put(&1, tag_key))
            end)
        end
      end)

    # Second pass: evaluate visibility, update key_data and tag_to_keys together
    {keys_to_delete, updated_key_data, updated_tag_to_keys} =
      Enum.reduce(matched_keys_with_entries, {[], key_data, tag_to_keys}, fn {key,
                                                                              removed_entries},
                                                                             {deletes, kd_acc,
                                                                              ttk_acc} ->
        case Map.get(kd_acc, key) do
          nil ->
            {deletes, kd_acc, ttk_acc}

          %{tags: current_entries, msg: msg} = data ->
            deactivated_positions =
              MapSet.new(removed_entries, fn {pos, _} -> pos end)

            updated_ac =
              data.active_conditions
              |> Enum.with_index()
              |> Enum.map(fn {val, idx} ->
                if MapSet.member?(deactivated_positions, idx), do: false, else: val
              end)

            visible = row_visible?(updated_ac, disjunct_positions)

            if not visible do
              ttk_acc = remove_key_from_tags(ttk_acc, current_entries, key)

              {[{key, msg} | deletes], Map.delete(kd_acc, key), ttk_acc}
            else
              updated_data = %{data | active_conditions: updated_ac}
              {deletes, Map.put(kd_acc, key, updated_data), ttk_acc}
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

  @doc """
  Evaluate DNF visibility from active_conditions and disjunct structure.

  A row is visible if at least one disjunct is satisfied.
  A disjunct is satisfied when all its positions have `active_conditions[pos] == true`.
  """
  @spec row_visible?([boolean()], [[non_neg_integer()]]) :: boolean()
  def row_visible?(active_conditions, disjunct_positions) do
    Enum.any?(disjunct_positions, fn positions ->
      Enum.all?(positions, fn pos ->
        Enum.at(active_conditions, pos, false) == true
      end)
    end)
  end

  @doc """
  Activate positions for keys matching move-in patterns.

  Sets `active_conditions[pos]` to `true` for keys that have
  matching `{pos, value}` entries in the tag index.

  Returns `{updated_tag_to_keys, updated_key_data}`.
  """
  @spec handle_move_in(tag_to_keys(), key_data(), [map()]) ::
          {tag_to_keys(), key_data()}
  def handle_move_in(tag_to_keys, key_data, patterns) do
    updated_key_data =
      Enum.reduce(patterns, key_data, fn %{pos: pos, value: value}, kd_acc ->
        tag_key = {pos, value}

        case Map.get(tag_to_keys, tag_key) do
          nil ->
            kd_acc

          keys ->
            Enum.reduce(keys, kd_acc, fn key, acc ->
              case Map.get(acc, key) do
                %{active_conditions: ac} = data when ac != nil ->
                  updated_ac = List.replace_at(ac, pos, true)
                  Map.put(acc, key, %{data | active_conditions: updated_ac})

                _ ->
                  acc
              end
            end)
        end
      end)

    {tag_to_keys, updated_key_data}
  end

  @doc """
  Normalize slash-delimited wire format tags to 2D arrays.

  Each tag string represents a disjunct with "/" separating position hashes.
  Empty strings are replaced with nil (position not relevant to this disjunct).

  ## Examples

      iex> Electric.Client.TagTracker.normalize_tags(["hash_a/hash_b"])
      [["hash_a", "hash_b"]]

      iex> Electric.Client.TagTracker.normalize_tags(["hash_a/", "/hash_b"])
      [["hash_a", nil], [nil, "hash_b"]]

      iex> Electric.Client.TagTracker.normalize_tags(["tag_a"])
      [["tag_a"]]
  """
  @spec normalize_tags([String.t()]) :: [[String.t() | nil]]
  def normalize_tags([]), do: []

  def normalize_tags(tags) do
    Enum.map(tags, fn tag ->
      tag
      |> String.split("/")
      |> Enum.map(fn
        "" -> nil
        hash -> hash
      end)
    end)
  end

  # --- Private helpers ---

  # Extract {position, hash} entries from normalized 2D tags.
  defp extract_position_entries(normalized_tags) do
    normalized_tags
    |> Enum.flat_map(fn disjunct ->
      disjunct
      |> Enum.with_index()
      |> Enum.flat_map(fn
        {nil, _pos} -> []
        {hash, pos} -> [{pos, hash}]
      end)
    end)
    |> MapSet.new()
  end

  # Derive disjunct positions from normalized tags.
  # Each disjunct lists the positions that are non-nil.
  defp derive_disjunct_positions([]), do: []

  defp derive_disjunct_positions(normalized_tags) do
    Enum.map(normalized_tags, fn disjunct ->
      disjunct
      |> Enum.with_index()
      |> Enum.flat_map(fn
        {nil, _pos} -> []
        {_hash, pos} -> [pos]
      end)
    end)
  end

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
