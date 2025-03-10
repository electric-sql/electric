defmodule Electric.ShapeCache.FileStorage.ActionFile do
  @moduledoc false
  alias Electric.Utils
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.ShapeCache.FileStorage.KeyIndex
  import KeyIndex, only: :macros

  @doc """
  Convert a sorted key index to a sorted action file.

  Action file is line-for-line mapping of log file offsets to actions of "keep", "skip" or "compact".
  It's ordering should be the same as the log file to allow for sequential reads of both.

  For "keep" lines, we keep the original, for "skip" lines, we skip the original, and for "compact" lines,
  we read all specified JSONs from the log file and merge them into one. Multiple updates to the the same
  key are mapped to be "skipped" for all but the last one, which is then mapped to "compact"

  Action file format is, in elixir binary:

      <<operation_offset::128, operation_type::binary>>

  Where `operation_type` is one of:

      <<?k::8>> #- Keep
      <<?s::8>> #- Skip
      <<?c::8, json_offsets_count::16, json_offsets::binary>> #- Compact

  And `json_offsets` is `json_offsets_count` of `<<json_start_position::64, json_size::64>>`
  """
  def create_from_key_index(key_index_path, action_file_path) do
    KeyIndex.stream(key_index_path)
    |> Stream.chunk_by(&key_index_item(&1, :key))
    |> Stream.flat_map(fn chunk ->
      # Chunk contains all operations for a given key in order

      chunk
      |> Enum.chunk_by(&key_index_item(&1, :op_type))
      |> Enum.flat_map(fn
        # Keep any single operation, since inserts/deletes won't be duplicated, and one update can't be compacted
        [key_index_item(offset: offset)] -> [<<LogFile.offset(offset)::binary, ?k::8>>]
        # If more than one, then it's definitely an update
        updates -> updates_to_actions(updates)
      end)
    end)
    |> Enum.into(File.stream!(action_file_path))

    Utils.external_merge_sort(action_file_path, &stream_for_sorting/1)
  end

  @doc """
  Read the action file and return a stream of tuples `{offset, action}`.
  """
  @spec stream(path :: String.t()) ::
          Enumerable.t(
            {LogFile.offset(),
             :keep | :skip | {:compact, [{non_neg_integer(), non_neg_integer()}, ...]}}
          )
  def stream(action_file_path) do
    Stream.resource(
      fn -> File.open!(action_file_path, [:read, :raw, :read_ahead]) end,
      fn file ->
        case IO.binread(file, 17) do
          :eof ->
            {:halt, file}

          <<tx_offset::64, op_offset::64, ?c::8>> ->
            <<count::16>> = IO.binread(file, 2)
            offsets = for <<pos::64, size::64 <- IO.binread(file, 16 * count)>>, do: {pos, size}
            {[{{tx_offset, op_offset}, {:compact, offsets}}], file}

          <<tx_offset::64, op_offset::64, ?k::8>> ->
            {[{{tx_offset, op_offset}, :keep}], file}

          <<tx_offset::64, op_offset::64, ?s::8>> ->
            {[{{tx_offset, op_offset}, :skip}], file}
        end
      end,
      &File.close/1
    )
  end

  # acc format: {positions_len, positions, actions}
  defp updates_to_actions(updates, acc \\ {0, [], []})
  # We don't care about order being reversed because it's going to be sorted.
  defp updates_to_actions([], {_, _, acc}), do: acc

  # The compaction target is either last one, or after we hit 65535 updates. Technically makes it suboptimal,
  # but saves us a lot of memory because the position list will take up at most 65535 * 16 = 1048560 bytes ~ 1MB of memory,
  # as opposed to 65536MB if we allow int32 positions.
  defp updates_to_actions(
         [key_index_item(offset: offset, json: last) | rest],
         {total_positions, positions, actions}
       )
       when rest == []
       when total_positions > 65534 do
    actions =
      [
        [
          <<LogFile.offset(offset)::binary, ?c::8, length(positions) + 1::16>>,
          Utils.list_reverse_map([last | positions], fn {pos, size} -> <<pos::64, size::64>> end)
        ]
        | actions
      ]

    updates_to_actions(rest, {0, [], actions})
  end

  defp updates_to_actions(
         [key_index_item(offset: offset, json: position) | rest],
         {total_positions, all_positions, actions}
       ) do
    updates_to_actions(
      rest,
      {total_positions + 1, [position | all_positions],
       [[<<LogFile.offset(offset)::binary, ?s::8>>] | actions]}
    )
  end

  @spec stream_for_sorting(file :: :file.io_device()) ::
          Utils.sortable_binary({binary(), non_neg_integer(), non_neg_integer()}) | :halt
  defp stream_for_sorting(file) do
    case IO.binread(file, 17) do
      :eof ->
        :halt

      <<tx_offset::64, op_offset::64, ?c::8>> = line ->
        <<count::16>> = IO.binread(file, 2)

        {{tx_offset, op_offset}, line <> <<count::16>> <> IO.binread(file, count * 16)}

      <<tx_offset::64, op_offset::64, _::8>> = line ->
        {{tx_offset, op_offset}, line}
    end
  end
end
