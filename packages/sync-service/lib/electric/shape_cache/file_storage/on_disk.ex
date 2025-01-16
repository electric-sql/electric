defmodule Electric.ShapeCache.FileStorage.OnDisk do
  @moduledoc false
  alias Electric.ShapeCache.LogChunker
  alias Electric.LogItems
  alias Electric.Utils
  alias Electric.Replication.LogOffset
  import Record

  defrecord(:log_file_line_info,
    log_offset: nil,
    key_size: nil,
    key: nil,
    op_type: nil,
    json_size: nil,
    start_position: nil,
    json_start_position: nil
  )

  # Log file structure is, in elixir binary:
  # <<tx_offset::64, op_offset::64, key_size::32, key::binary, op_type::binary-size(1), json_size::64, json::binary>>

  # Log compaction is supported by the following algorithm, which aims to minimize the RAM
  # usage of the compaction process:
  #
  # 1. Create a key index of the log file, which maps each key to a position of in the log file
  #    Key index file structure is, in elixir binary:
  #    <<key_size::32, key::binary, operation_offset::128, operation_type::8, json_start_position::64, json_size::64>>
  # 2. Sort the key index so that all operations that touch the same key are adjacent
  # 3. Generate an action file from the key index. Action file maps operation offsets to one
  #    of the following actions: "keep", "skip", "compact", with "compact" specifying a list of file offsets
  #    to be read back and compacted into one operation.
  #
  #    Action file structure is, in elixir binary:
  #    <<operation_offset::128, ?k::8>> | <<operation_offset::128, ?s::8>> | <<operation_offset::128, ?c::8, json_offsets_count::64, json_offsets::binary>>
  #    Where json_offsets is `json_offsets_count` of <<json_start_position::64, json_size::64>>
  #
  # 4. Sort the action file by operation offset
  # 5. Read the log file together with action file, applying actions to each offset as you see them. Applying a "compact" means seeking
  #    back to read all the specified offsets and merge them into one operation

  # The other supporting file for the log file itself is a chunk index. It's an index of fixed-size chunks with notes about the first and last
  # offsets of each chunk. It's used to optimize for cache hits and response sizes and is computed as we write the log file.
  # The file uses fixed-width entries for binary search. Each entry is:
  # <<first_offset::128, first_position::64,last_offset::128, last_position::64>>

  @log_file_line_overhead 8 + 8 + 4 + 1 + 8

  @type log_offset :: {tx_offset :: non_neg_integer, op_offset :: non_neg_integer}
  @type log_file_line_info ::
          record(:log_file_line_info,
            log_offset: log_offset(),
            key_size: non_neg_integer(),
            key: binary(),
            op_type: binary(),
            json_size: non_neg_integer(),
            start_position: non_neg_integer(),
            json_start_position: non_neg_integer()
          )

  def create_sorted_key_index(log_file_path) do
    stream_log_file_info(log_file_path)
    |> Stream.map(fn log_file_line_info(
                       log_offset: {tx_offset, op_offset},
                       key_size: key_size,
                       key: key,
                       op_type: op_type,
                       json_start_position: json_start_position,
                       json_size: json_size
                     ) ->
      <<key_size::32, key::binary, tx_offset::64, op_offset::64, op_type::binary-size(1),
        json_start_position::64, json_size::64>>
    end)
    |> Stream.into(File.stream!(log_file_path <> ".key_index"))
    |> Stream.run()

    sort_key_index(log_file_path <> ".key_index")
  end

  def sort_key_index(key_index_path) do
    :ok = Utils.external_merge_sort(key_index_path, &stream_key_index_file_for_sorting/1, &<=/2)
    key_index_path
  end

  def create_action_file(log_file_path, key_index_path) do
    key_index_path
    |> stream_key_index_file()
    |> Stream.chunk_by(fn {key, _op_type, _log_offset, _file_position} -> key end)
    |> Stream.flat_map(fn chunk ->
      chunk
      |> Enum.chunk_by(fn {_key, op_type, _log_offset, _file_position} -> op_type end)
      |> Enum.flat_map(fn
        # Keep any single operation, since inserts/deletes won't be duplicated, and one update can't be compacted
        [{_key, _op_type, {tx_offset, op_offset}, _}] -> [<<tx_offset::64, op_offset::64, ?k::8>>]
        # If more than one, then it's definitely an update
        updates -> updates_to_actions(updates)
      end)
    end)
    |> Stream.into(File.stream!(log_file_path <> ".actions"))
    |> Stream.run()

    Utils.external_merge_sort(
      log_file_path <> ".actions",
      &stream_action_file_for_sorting/1,
      &<=/2
    )

    log_file_path <> ".actions"
  end

  defp stream_action_file_for_sorting(path) do
    Stream.resource(
      fn -> File.open!(path, [:read, :raw, :read_ahead]) end,
      fn file ->
        with <<tx_offset::64, op_offset::64, action::8>> <- IO.binread(file, 17) do
          sorting_key = {tx_offset, op_offset}

          if action == ?c do
            <<count::32>> = IO.binread(file, 4)

            {[
               {sorting_key,
                <<tx_offset::64, op_offset::64, action::8, count::32,
                  IO.binread(file, count * 16)::binary>>}
             ], file}
          else
            {[{sorting_key, <<tx_offset::64, op_offset::64, action::8>>}], file}
          end
        else
          :eof -> {:halt, file}
        end
      end,
      &File.close(elem(&1, 0))
    )
  end

  def apply_actions(
        log_file_path,
        action_file_path,
        merge_updates_fun \\ &LogItems.merge_updates/2,
        chunk_size \\ LogChunker.default_chunk_size_threshold()
      ) do
    # `:file.copy/3` is not optimized to use a syscall, so basic stream forming is good enough.
    Stream.resource(
      fn ->
        {File.open!(log_file_path, [:read, :raw, :read_ahead]),
         File.open!(action_file_path, [:read, :raw, :read_ahead])}
      end,
      fn {log_file, action_file} ->
        with <<_log_offset::128, action::8>> <- IO.binread(action_file, 17) do
          case action do
            # Keep
            ?k ->
              {[read_log_file_line(log_file)], {log_file, action_file}}

            ?s ->
              {[], {skip_log_file_line(log_file), action_file}}

            ?c ->
              with <<count::32>> <- IO.binread(action_file, 4),
                   file_offsets <- IO.binread(action_file, count * 16) do
                {[compact_log_file_lines(log_file, file_offsets, merge_updates_fun)],
                 {log_file, action_file}}
              end
          end
        else
          :eof -> {:halt, {log_file, action_file}}
        end
      end,
      fn {log_file, action_file} ->
        File.close(log_file)
        File.close(action_file)
      end
    )
    |> write_log_file(log_file_path <> ".compacted", chunk_size)

    File.rename!(log_file_path <> ".compacted" <> ".chunk_index", log_file_path <> ".chunk_index")
    File.rename!(log_file_path <> ".compacted", log_file_path)
  end

  defp read_log_file_line(file) do
    with <<tx_offset::64, op_offset::64, key_size::32>> <- IO.binread(file, 20),
         <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
         <<op_type::binary-size(1), json_size::64>> <- IO.binread(file, 9),
         <<json::binary-size(json_size)>> <- IO.binread(file, json_size) do
      {{tx_offset, op_offset}, key_size, key, op_type, json_size, json}
    else
      :eof -> raise "unexpected end of file"
    end
  end

  defp skip_log_file_line(file) do
    # It's more efficient to read the line and throw it away than to seek
    # because we're using read_ahead and `:file.position/2` throws away the
    # read_ahead buffer (https://github.com/erlang/otp/blob/OTP-27.2/erts/preloaded/src/prim_file.erl#L321-L324)
    with <<_::64, _::64, key_size::32>> <- IO.binread(file, 20),
         <<_::binary-size(key_size)>> <- IO.binread(file, key_size),
         <<_::binary-size(1), json_size::64>> <- IO.binread(file, 9),
         <<_::binary-size(json_size)>> <- IO.binread(file, json_size) do
      file
    else
      :eof -> raise "unexpected end of file"
    end
  end

  defp compact_log_file_lines(file, file_offsets, merge_updates_fun) do
    {offset, key_size, key, op_type, _, _} = read_log_file_line(file)

    {:ok, current_position} = :file.position(file, :cur)

    merged_json =
      for(<<pos::64, size::64 <- file_offsets>>, do: {pos, size})
      # Don't load more than a 100 of JSONs into memory at a time
      # This is to limit the amount of memory consumed by the compaction process
      |> Stream.chunk_every(100)
      |> Stream.flat_map(fn offsets ->
        case :file.pread(file, offsets) do
          {:ok, results} -> results
          {:error, reason} -> raise inspect(reason)
          :eof -> raise "unexpected end of file while reading back jsons from the log"
        end
      end)
      |> Stream.map(&Jason.decode!/1)
      |> Enum.reduce(fn new, acc -> merge_updates_fun.(acc, new) end)
      |> Jason.encode!()

    {:ok, _} = :file.position(file, {:bof, current_position})

    {offset, key_size, key, op_type, byte_size(merged_json), merged_json}
  end

  defp updates_to_actions(updates, acc \\ {[], []})
  defp updates_to_actions([], {_, acc}), do: acc
  # Last one is the compaction target
  defp updates_to_actions(
         [{_key, _op_type, {tx_offset, op_offset}, file_position}],
         {all_positions, actions}
       ) do
    [
      [
        <<tx_offset::64, op_offset::64, ?c::8, length(all_positions) + 1::32>>,
        Utils.list_reverse_map([file_position | all_positions], fn {pos, size} ->
          <<pos::64, size::64>>
        end)
      ]
      | actions
    ]
  end

  defp updates_to_actions(
         [{_key, _op_type, {tx_offset, op_offset}, file_position} | rest],
         {all_positions, actions}
       ) do
    updates_to_actions(
      rest,
      {[file_position | all_positions], [[<<tx_offset::64, op_offset::64, ?s::8>>] | actions]}
    )
  end

  @doc """
  Returns a stream of information about the log file lines
  """
  @spec stream_log_file_info(String.t()) :: Enumerable.t(log_file_line_info())
  def stream_log_file_info(log_file_path) do
    Stream.resource(
      fn -> {File.open!(log_file_path, [:read, :raw, :read_ahead]), 0} end,
      fn {file, read_position} ->
        with <<tx_offset::64, op_offset::64, key_size::32>> <- IO.binread(file, 20),
             <<key::binary-size(^key_size)>> <- IO.binread(file, key_size),
             <<op_type::binary-size(1), json_size::64>> <- IO.binread(file, 9),
             <<_::binary-size(json_size)>> <- IO.binread(file, json_size) do
          {[
             log_file_line_info(
               log_offset: {tx_offset, op_offset},
               key_size: key_size,
               key: key,
               op_type: op_type,
               json_size: json_size,
               start_position: read_position,
               json_start_position: read_position + @log_file_line_overhead + key_size
             )
           ], {file, read_position + @log_file_line_overhead + key_size + json_size}}
        else
          :eof ->
            {:halt, file}

          bin ->
            raise "Malformed log file #{log_file_path}: #{inspect(bin)}"
        end
      end,
      &File.close(elem(&1, 0))
    )
  end

  # The overhead in bytes of a log file line in addition to key and json binaries: tx_offset::64 + op_offset::64 + key_size::32 + op_type::8 + json_size::64

  def write_log_file(
        log_stream,
        log_file_path,
        chunk_size \\ LogChunker.default_chunk_size_threshold()
      ) do
    log_stream
    |> normalize_log_stream()
    |> write_chunk_index(log_file_path <> ".chunk_index", chunk_size)
    # |> write_key_index(log_file_path <> ".key_index")
    |> Stream.map(fn
      {log_offset, key_size, key, op_type, json_size, json} ->
        <<log_offset_to_binary(log_offset)::binary, key_size::32, key::binary,
          op_type::binary-size(1), json_size::64, json::binary>>
    end)
    |> Stream.into(File.stream!(log_file_path))
    |> Stream.run()
  end

  defp normalize_log_stream(stream) do
    Stream.map(stream, fn
      {log_offset, key, op_type, json} ->
        {log_offset, byte_size(key), key, get_op_type(op_type), byte_size(json), json}

      {_, _, _, _, _, _} = formed_line ->
        formed_line
    end)
  end

  defp write_chunk_index(stream, chunk_index_path, chunk_size) do
    Stream.transform(
      stream,
      fn ->
        file = File.open!(chunk_index_path, [:write, :raw])
        {file, 0, 0, nil}
      end,
      fn {offset, key_size, _, _, json_size, _} = line,
         {file, write_position, byte_count, last_seen_offset} ->
        if is_nil(last_seen_offset),
          do: IO.binwrite(file, <<log_offset_to_binary(offset)::binary, write_position::64>>)

        position_after_write = write_position + @log_file_line_overhead + key_size + json_size

        # We're counting bytes only on JSON payloads that are actually sent to the client
        case LogChunker.fit_into_chunk(json_size, byte_count, chunk_size) do
          {:ok, new_size} ->
            {[line], {file, position_after_write, new_size, offset}}

          {:threshold_exceeded, 0} ->
            IO.binwrite(file, <<log_offset_to_binary(offset)::binary, position_after_write::64>>)

            {[line], {file, position_after_write, 0, nil}}
        end
      end,
      fn {file, pos, _, last_offset} ->
        if not is_nil(last_offset),
          do: IO.binwrite(file, <<log_offset_to_binary(last_offset)::binary, pos::64>>)

        {[], {file}}
      end,
      &File.close(elem(&1, 0))
    )
  end

  def read_json_chunk(log_file_path, %LogOffset{} = exclusive_min_offset) do
    case find_json_chunk(log_file_path, exclusive_min_offset) do
      {:ok, start_position, end_position} ->
        # We can read ahead entire chunk into memory since chunk sizes are expected to be ~10MB by default,
        file = File.open!(log_file_path, [:read, :raw])

        try do
          with {:ok, data} <- :file.pread(file, start_position, end_position - start_position) do
            extract_jsons_from_binary(data, exclusive_min_offset, [])
          end
        after
          File.close(file)
        end

      :error ->
        []
    end
  end

  defp extract_jsons_from_binary(<<>>, _, acc), do: Enum.reverse(acc)

  defp extract_jsons_from_binary(
         <<tx_offset1::64, op_offset1::64, key_size::32, _::binary-size(key_size),
           _::binary-size(1), json_size::64, _::binary-size(json_size), rest::binary>>,
         %LogOffset{
           tx_offset: tx_offset2,
           op_offset: op_offset2
         } = log_offset,
         acc
       )
       when tx_offset1 < tx_offset2 or (tx_offset1 == tx_offset2 and op_offset1 <= op_offset2),
       do: extract_jsons_from_binary(rest, log_offset, acc)

  defp extract_jsons_from_binary(
         <<_::128, key_size::32, _::binary-size(key_size), _::binary-size(1), json_size::64,
           json::binary-size(json_size), rest::binary>>,
         log_offset,
         acc
       ),
       do: extract_jsons_from_binary(rest, log_offset, [json | acc])

  def read_all_json_chunks(log_file_path) do
    File.stream!(log_file_path <> ".chunk_index", 48)
    |> Stream.map(fn <<tx_offset::64, op_offset::64, file_position_start::64, last_tx_offset::64,
                       last_op_offset::64, file_position_end::64>> ->
      offset_boundaries =
        {LogOffset.new(tx_offset, op_offset), LogOffset.new(last_tx_offset, last_op_offset),
         position: {file_position_start, file_position_end}}

      file = File.open!(log_file_path, [:read, :raw, :read_ahead])
      :file.position(file, file_position_start)

      read_stream =
        Stream.unfold(file_position_start, fn position ->
          if position >= file_position_end do
            nil
          else
            {_, key_size, _, _, json_size, json} = read_log_file_line(file)
            total_read = key_size + json_size + 29
            {json, position + total_read}
          end
        end)

      {offset_boundaries, Enum.to_list(read_stream)}
    end)
  end

  @chunk_entry_size 48

  # The "correct" JSON chunk is the one that contains the first log offset that is greater than
  # the given log offset. Since our chunk map contains inclusive boundaries, we use that info
  # for the binary search
  defp find_json_chunk(
         log_file_path,
         %LogOffset{tx_offset: _tx_offset, op_offset: _op_offset} = log_offset
       ) do
    file = File.open!(log_file_path <> ".chunk_index", [:read, :raw])
    file_size = File.stat!(log_file_path <> ".chunk_index").size

    try do
      case do_binary_search(file, 0, div(file_size, @chunk_entry_size) - 1, log_offset) do
        {:ok, start_pos, end_pos} -> {:ok, start_pos, end_pos}
        nil -> :error
      end
    after
      File.close(file)
    end
  end

  defp do_binary_search(file, left, right, %LogOffset{} = target)
       when left <= right do
    mid = div(left + right, 2)

    {:ok, <<_min_tx::64, _min_op::64, start_pos::64, max_tx::64, max_op::64, end_pos::64>>} =
      :file.pread(file, mid * @chunk_entry_size, @chunk_entry_size)

    max_offset = %LogOffset{tx_offset: max_tx, op_offset: max_op}

    case {LogOffset.compare(target, max_offset), mid} do
      {:lt, mid} when mid > 0 ->
        # Target is less than max_offset, this chunk might be the answer
        # but let's check if there's a better one in the left half
        do_binary_search(file, left, mid - 1, target) || {:ok, start_pos, end_pos}

      {:lt, _} ->
        {:ok, start_pos, end_pos}

      {x, mid} when x in [:gt, :eq] and mid < right ->
        # Target is greater than max_offset, need to look in right half
        do_binary_search(file, mid + 1, right, target)

      _ ->
        # Target is greater than max_offset but we're at the end
        nil
    end
  end

  defp do_binary_search(_file, _left, _right, _target), do: nil

  defp get_op_type(op_type) do
    case op_type do
      :insert -> "i"
      :update -> "u"
      :delete -> "d"
    end
  end

  defp log_offset_to_binary({tx_offset, op_offset}), do: <<tx_offset::64, op_offset::64>>

  defp log_offset_to_binary(%LogOffset{tx_offset: tx_offset, op_offset: op_offset}),
    do: <<tx_offset::64, op_offset::64>>

  defp stream_key_index_file_for_sorting(path) do
    Stream.resource(
      fn -> File.open!(path, [:read, :raw, :read_ahead]) end,
      fn file ->
        with <<key_size::32>> <- IO.binread(file, 4),
             <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
             <<tx_offset::64, op_offset::64, op_type::binary-size(1), json_start_position::64,
               json_size::64>> <-
               IO.binread(file, 17 + 8 + 8) do
          full_line =
            <<key_size::32, key::binary, tx_offset::64, op_offset::64, op_type::binary-size(1),
              json_start_position::64, json_size::64>>

          {[{{key, tx_offset, op_offset}, full_line}], file}
        else
          :eof -> {:halt, file}
        end
      end,
      &File.close/1
    )
  end

  @spec stream_key_index_file(String.t()) ::
          Enumerable.t(
            {key :: binary, op_type :: binary, log_offset(),
             json_position :: {file_position :: non_neg_integer, size :: non_neg_integer}}
          )
  defp stream_key_index_file(path) do
    Stream.resource(
      fn -> File.open!(path, [:read, :raw, :read_ahead]) end,
      fn file ->
        with <<key_size::32>> <- IO.binread(file, 4),
             <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
             <<tx_offset::64, op_offset::64, op_type::binary-size(1), json_start_position::64,
               json_size::64>> <-
               IO.binread(file, 8 * 4 + 1) do
          {[{key, op_type, {tx_offset, op_offset}, {json_start_position, json_size}}], file}
        else
          :eof -> {:halt, file}
        end
      end,
      &File.close/1
    )
  end
end
