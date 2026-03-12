defmodule Support.ConsumerProperty.Invariants do
  @moduledoc """
  Walks a consumer log and materializes state, asserting correctness invariants.

  The single invariant: for every operation in the log, applying it to the current
  materialized state must be valid (no duplicate INSERTs, no missing UPDATEs/DELETEs).
  """

  def walk_and_materialize(log_items, initial_rows \\ %{}, initial_tag_indices \\ %{}) do
    initial = %{index: initial_rows, tag_indices: initial_tag_indices}

    Enum.reduce(log_items, initial, fn %{"headers" => headers} = item, state ->
      txn =
        if Map.has_key?(headers, "txids"), do: " at #{Map.get(headers, "txids") |> hd}", else: nil

      case item do
        %{"key" => key, "value" => value, "headers" => %{"operation" => "insert"} = headers} ->
          if Map.has_key?(state.index, key) do
            raise "INSERT for already-present key #{key}#{txn}\nCurrent state keys: #{inspect(Map.keys(state.index))}"
          end

          tags = Map.get(headers, "tags", [])

          state
          |> put_in_index(key, value)
          |> add_to_tag_indices(key, tags)

        %{"key" => key, "value" => value, "headers" => %{"operation" => "update"} = headers} ->
          unless Map.has_key?(state.index, key) do
            raise "UPDATE for absent key #{key}#{txn}\nCurrent state keys: #{inspect(Map.keys(state.index))}"
          end

          removed_tags = Map.get(headers, "removed_tags", [])
          new_tags = Map.get(headers, "tags", [])

          state
          |> update_in_index(key, value)
          |> remove_from_tag_indices(key, removed_tags)
          |> add_to_tag_indices(key, new_tags)

        %{"key" => key, "headers" => %{"operation" => "delete"}} ->
          unless Map.has_key?(state.index, key) do
            raise "DELETE for absent key #{key}#{txn}\nCurrent state keys: #{inspect(Map.keys(state.index))}"
          end

          state
          |> remove_key_from_all_tag_indices(key)
          |> delete_from_index(key)

        %{"headers" => %{"event" => "move-out", "patterns" => patterns}} ->
          keys_to_remove = resolve_patterns(state.tag_indices, patterns)

          Enum.reduce(keys_to_remove, state, fn key, state ->
            state
            |> remove_key_from_all_tag_indices(key)
            |> delete_from_index(key)
          end)

        %{"headers" => %{"control" => "snapshot-end"}} ->
          state

        _ ->
          state
      end
    end)
    |> Map.get(:index)
  end

  defp put_in_index(state, key, value) do
    %{state | index: Map.put(state.index, key, value)}
  end

  defp update_in_index(state, key, value) do
    %{state | index: Map.update!(state.index, key, &Map.merge(&1, value))}
  end

  defp delete_from_index(state, key) do
    %{state | index: Map.delete(state.index, key)}
  end

  defp add_to_tag_indices(state, _key, []), do: state

  defp add_to_tag_indices(state, key, tags) do
    tag_indices =
      Enum.reduce(tags, state.tag_indices, fn tag, acc ->
        Map.update(acc, tag, MapSet.new([key]), &MapSet.put(&1, key))
      end)

    %{state | tag_indices: tag_indices}
  end

  defp remove_from_tag_indices(state, _key, []), do: state

  defp remove_from_tag_indices(state, key, tags) do
    tag_indices =
      Enum.reduce(tags, state.tag_indices, fn tag, acc ->
        case Map.fetch(acc, tag) do
          {:ok, set} ->
            new_set = MapSet.delete(set, key)

            if MapSet.size(new_set) == 0,
              do: Map.delete(acc, tag),
              else: Map.put(acc, tag, new_set)

          :error ->
            acc
        end
      end)

    %{state | tag_indices: tag_indices}
  end

  defp remove_key_from_all_tag_indices(state, key) do
    tag_indices =
      Map.new(state.tag_indices, fn {tag, set} ->
        {tag, MapSet.delete(set, key)}
      end)
      |> Enum.reject(fn {_tag, set} -> MapSet.size(set) == 0 end)
      |> Map.new()

    %{state | tag_indices: tag_indices}
  end

  defp resolve_patterns(tag_indices, patterns) do
    Enum.reduce(patterns, MapSet.new(), fn %{"pos" => _pos, "value" => value}, keys ->
      case Map.fetch(tag_indices, value) do
        {:ok, set} -> MapSet.union(keys, set)
        :error -> keys
      end
    end)
  end
end
