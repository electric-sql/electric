defmodule Electric.ShapeCache.PureFileStorage.ActionFile do
  @moduledoc false
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.PureFileStorage.KeyIndex
  alias Electric.ShapeCache.PureFileStorage.LogFile
  alias Electric.Utils

  defp base_entry({_, label, offset, _type, entry_start, _}, action),
    do: base_entry(offset, label, entry_start, action)

  defp base_entry(offset, label, entry_start, action) when action in [:keep, :skip] do
    action_tag = if action == :keep, do: ?k, else: ?s
    # 26 = 16 (offset) + 1 (label) + 8 (entry_start) + 1 (keep)

    <<26::32, LogOffset.to_int128(offset)::binary, label::8, entry_start::64, action_tag::8>>
  end

  defp compaction_entry({_, label, offset, _type, entry_start, _} = item, other_positions) do
    # 28 + 17p = 16 (offset) + 1 (label) + 8 (entry_start) + 1 (compaction) + 2 (positions_len) + positions_len * (8 (pos) + 8 (len) + 1 label)
    [
      <<28 + 17 * (length(other_positions) + 1)::32, LogOffset.to_int128(offset)::binary,
        label::8, entry_start::64, ?c::8, length(other_positions) + 1::16>>,
      Utils.list_reverse_map([infer_json_position(item) | other_positions], fn {label, pos, size} ->
        <<label::8, pos::64, size::64>>
      end)
    ]
  end

  defp infer_json_position({{key_size, _key}, label, _offset, _type, entry_start, json_size}) do
    {label, LogFile.expected_json_position(entry_start, key_size), json_size}
  end

  def create_from_key_index(key_index_path, action_file_path)
      when is_binary(key_index_path) and is_binary(action_file_path) do
    KeyIndex.stream_for_actions(key_index_path)
    |> Stream.chunk_by(&elem(&1, 0))
    |> Stream.map(fn chunk ->
      # Chunk contains all operations for a given key in order

      chunk
      |> Enum.chunk_by(&elem(&1, 3))
      |> Enum.map(fn
        # Keep any single operation, since inserts/deletes won't be duplicated, and one update can't be compacted
        [{_, label, offset, _, entry_start, _}] ->
          base_entry(offset, label, entry_start, :keep)

        # If more than one, then it's definitely an update
        updates ->
          updates_to_actions(updates)
      end)
    end)
    |> Stream.into(File.stream!(action_file_path, [:delayed_write]))
    |> Stream.run()

    :ok =
      :file_sorter.sort([to_charlist(action_file_path)], to_charlist(action_file_path),
        format: fn <<tx::64, op::64>> <> _ -> {tx, op} end
      )

    action_file_path
  end

  # acc format: {positions_len, positions, actions}
  defp updates_to_actions(updates, acc \\ {0, [], []})
  # We don't care about order being reversed because it's going to be sorted.
  defp updates_to_actions([], {_, _, acc}), do: acc

  # The compaction target is either last one, or after we hit 65535 updates. Technically makes it suboptimal,
  # but saves us a lot of memory because the position list will take up at most 65535 * 16 = 1048560 bytes ~ 1MB of memory,
  # as opposed to 65536MB if we allow int32 positions.
  defp updates_to_actions([item | rest], {total_positions, positions, actions})
       when rest == []
       when total_positions > 65534 do
    actions = [compaction_entry(item, positions) | actions]

    updates_to_actions(rest, {0, [], actions})
  end

  defp updates_to_actions([item | rest], {total_positions, all_positions, actions}) do
    updates_to_actions(
      rest,
      {total_positions + 1, [infer_json_position(item) | all_positions],
       [base_entry(item, :skip) | actions]}
    )
  end

  def stream(action_file_path) do
    Stream.resource(
      fn -> File.open!(action_file_path, [:read, :raw, :read_ahead]) end,
      fn file ->
        case IO.binread(file, 30) do
          <<26::32, tx::64, op::64, label::8, entry_start::64, action_tag::8>> ->
            {[{{tx, op}, label, entry_start, if(action_tag == ?k, do: :keep, else: :skip)}], file}

          <<_::32, tx::64, op::64, label::8, entry_start::64, ?c::8>> ->
            <<count::16>> = IO.binread(file, 2)

            offsets =
              for <<label::8, pos::64, size::64 <- IO.binread(file, 17 * count)>>,
                do: {label, pos, size}

            {[{{tx, op}, label, entry_start, {:compact, offsets}}], file}

          :eof ->
            {:halt, file}
        end
      end,
      &File.close/1
    )
  end
end
