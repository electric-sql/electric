defmodule Electric.ShapeCache.PureFileStorage.LogFile do
  @moduledoc false
  alias Electric.ShapeCache.FileStorage.KeyIndex
  alias Electric.LogItems
  alias Electric.ShapeCache.FileStorage.ActionFile
  alias Electric.ShapeCache.FileStorage.ChunkIndex
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker

  import Electric.Replication.LogOffset, only: :macros

  # 16 bytes offset + 4 bytes key size + 1 byte op type + 1 byte processed flag + 8 bytes json size = 30 bytes
  @line_overhead 16 + 4 + 1 + 1 + 8

  @type operation_type() :: :insert | :update | :delete
  @type op_type() :: ?u | ?i | ?d
  # We're allowing tuple offsets to avoid struct creation in the hot path
  @type offset() ::
          {tx_offset :: non_neg_integer(), op_offset :: non_neg_integer()} | LogOffset.t()

  @typedoc "Log item that can be written to the log file"
  @type normal_log_item() ::
          {offset(), key :: String.t(), op_type :: operation_type(), json :: String.t()}
  @typedoc """
  Log item that can be read from the log file, but with precomputed
  `byte_size(key)` and `byte_size(json)` values, and with `op_type` as a byte
  """
  @type log_item_with_sizes() ::
          {offset(), key_size :: non_neg_integer(), key :: String.t(), op_type :: op_type(),
           processed_flag :: non_neg_integer(), json_size :: non_neg_integer(),
           json :: String.t()}
  @type log_item() :: normal_log_item() | log_item_with_sizes()

  @typedoc """
  Paths to the log file, chunk index, and key index files, used in conjuction
  """
  @type log_and_supporting() ::
          {log_file_path :: String.t(), chunk_index_path :: String.t(),
           key_index_path :: String.t()}

  @doc """
  Write a log file based on the stream of log items.

  Writes 2 files: the log file itself and the chunk index alongside it.

  The log file structure is, in elixir binary:

      <<tx_offset::64, op_offset::64,
        key_size::32, key::binary-size(key_size),
        op_type::binary-size(1),
        processed_flag::8,
        json_size::64, json::binary-size(json_size)>>
  """
  @spec write_log_file(
          log_stream :: Enumerable.t(log_item()),
          log_file_path :: String.t(),
          chunk_size :: non_neg_integer()
        ) :: log_and_supporting()
  def write_log_file(
        log_stream,
        log_file_path,
        chunk_size \\ LogChunker.default_chunk_size_threshold()
      ) do
    log_stream
    |> normalize_log_stream()
    |> ChunkIndex.write_from_stream(log_file_path <> ".chunk_index", chunk_size)
    |> KeyIndex.write_from_stream(log_file_path <> ".key_index")
    |> Stream.map(fn
      {log_offset, key_size, key, op_type, flag, json_size, json} ->
        # Add processed flag (0 for unprocessed) to header
        [
          <<offset(log_offset)::binary, key_size::32, key::binary, op_type::8, flag::8,
            json_size::64>>,
          json
        ]
    end)
    |> Enum.into(File.stream!(log_file_path))

    {log_file_path, log_file_path <> ".chunk_index", log_file_path <> ".key_index"}
  end

  @doc """
  Apply the compaction actions to the log file
  """
  def apply_actions(
        log_file_path,
        action_file_path,
        chunk_size \\ LogChunker.default_chunk_size_threshold(),
        merge_updates_fun \\ &LogItems.merge_updates/2
      ) do
    compacted_log_file_path = log_file_path <> ".compacted"

    ActionFile.stream(action_file_path)
    |> Stream.transform(
      fn -> File.open!(log_file_path, [:read, :raw, :read_ahead]) end,
      fn
        {_, :skip}, file ->
          _ = read_line(file)
          {[], file}

        {_, :keep}, file ->
          case read_line(file) do
            {offset, key_size, key, op_type, 0, _json_size, json} ->
              # First compaction - process JSON and mark as processed
              processed_json = process_json(json)

              new_line =
                {offset, key_size, key, op_type, 1, byte_size(processed_json), processed_json}

              {[new_line], file}

            line ->
              # Already processed or not insert/delete - keep as-is
              {[line], file}
          end

        {_, {:compact, offsets}}, file ->
          {[compact_log_file_lines(file, offsets, merge_updates_fun)], file}
      end,
      &File.close(&1)
    )
    |> write_log_file(compacted_log_file_path, chunk_size)
  end

  defp read_line(file) do
    with <<tx_offset::64, op_offset::64, key_size::32>> <- IO.binread(file, 20),
         <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
         <<op_type::8, processed_flag::8, json_size::64>> <- IO.binread(file, 10),
         <<json::binary-size(json_size)>> <- IO.binread(file, json_size) do
      {{tx_offset, op_offset}, key_size, key, op_type, processed_flag, json_size, json}
    end
  end

  @spec compact_log_file_lines(
          :file.io_device(),
          [{position :: non_neg_integer(), size :: non_neg_integer()}],
          (elem, elem -> elem)
        ) :: log_item_with_sizes()
        when elem: var
  defp compact_log_file_lines(file, file_offsets, merge_updates_fun) do
    # The line to be replaced with compaction will keep it's offset & key
    {offset, key_size, key, op_type, _, _, _} = read_line(file)

    # Save position
    {:ok, current_position} = :file.position(file, :cur)

    merged_json =
      file_offsets
      # Group reads to be efficient, but try to limit loading the JSONs to 10MB at a time.
      # In the worst case when JSONs exceed 10MB, we'll just read one at a time.
      |> chunk_expected_reads(bytes: 1024 * 1024 * 10)
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

    # Restore position to continue reading in the outer loop
    {:ok, _} = :file.position(file, {:bof, current_position})

    {offset, key_size, key, op_type, 1, byte_size(merged_json), merged_json}
  end

  @doc """
  Normalize the log stream to have precomputed key and json sizes.
  """
  @spec normalize_log_stream(Enumerable.t(log_item())) :: Enumerable.t(log_item_with_sizes())
  def normalize_log_stream(stream) do
    Stream.map(stream, fn
      {log_offset, key, op_type, json} ->
        {log_offset, byte_size(key), key, get_op_type(op_type), 0, byte_size(json), json}

      {_, _, _, _, _, _, _} = formed_line ->
        formed_line
    end)
  end

  @spec chunk_expected_reads(
          Enumerable.t({position :: non_neg_integer(), size :: non_neg_integer()}),
          bytes: non_neg_integer()
        ) :: Enumerable.t(list({position :: non_neg_integer(), size :: non_neg_integer()}))
  defp chunk_expected_reads(stream, bytes: chunk_size) do
    Stream.chunk_while(
      stream,
      {0, []},
      fn
        {_, size} = item, {total_size, acc} when total_size > chunk_size ->
          {:cont, Enum.reverse(acc), {size, [item]}}

        {_, size} = item, {total_size, acc} ->
          {:cont, {total_size + size, [item | acc]}}
      end,
      fn
        {_, []} -> {:cont, []}
        {_, acc} -> {:cont, Enum.reverse(acc), []}
      end
    )
  end

  @doc """
  Get the expected byte position in the file after the given log item is written.

  Used by other modules that know the log file structure.
  """
  @spec expected_position(non_neg_integer(), log_item_with_sizes()) :: non_neg_integer()
  def expected_position(
        current_position,
        {_log_offset, key_size, _key, _op_type, _processed_flag, json_size, _json}
      ) do
    current_position + key_size + json_size + @line_overhead
  end

  @doc """
  Get the expected byte position of the JSON for the given log item after it's written.

  Used by other modules that know the log file structure.
  """
  @spec expected_json_position(non_neg_integer(), log_item_with_sizes()) :: non_neg_integer()
  def expected_json_position(current_position, {_, key_size, _, _, _, _, _}) do
    current_position + key_size + @line_overhead
  end

  @doc """
  Read a chunk of the log file from the given offset.

  Returns a stream of json strings.
  """
  @spec read_chunk(log :: log_and_supporting(), LogOffset.t()) :: Enumerable.t(String.t())
  def read_chunk({log_file_path, chunk_index_path, _key_index_path}, %LogOffset{} = offset) do
    case ChunkIndex.fetch_chunk(chunk_index_path, offset) do
      {:ok, _max_offset, {start_position, end_position}} ->
        stream_jsons(log_file_path, start_position, end_position, offset)

      :error ->
        []
    end
  end

  def stream_jsons(log_file_path, start_position, end_position, exclusive_min_offset) do
    # We can read ahead entire chunk into memory since chunk sizes are expected to be ~10MB by default,
    file = File.open!(log_file_path, [:read, :raw])

    try do
      with {:ok, data} <- :file.pread(file, start_position, end_position - start_position) do
        {jsons, _} = extract_jsons_from_binary(data, exclusive_min_offset, nil)
        jsons
      else
        :eof -> raise "unexpected end of file"
        {:error, reason} -> raise "error reading file: #{inspect(reason)}"
      end
    after
      File.close(file)
    end
  end

  def stream_jsons_until_offset(
        log_file_path,
        start_position,
        exclusive_min_offset,
        inclusive_max_offset
      ) do
    Stream.resource(
      fn ->
        file = File.open!(log_file_path, [:read, :raw])
        {:ok, ^start_position} = :file.position(file, start_position)
        {file, ""}
      end,
      fn
        {file, binary_rest} ->
          case :file.read(file, 4096) do
            {:ok, data} ->
              {jsons, rest} =
                extract_jsons_from_binary(
                  binary_rest <> data,
                  exclusive_min_offset,
                  inclusive_max_offset
                )

              {jsons, {file, rest}}

            :eof ->
              {:halt, {file, binary_rest}}
          end
      end,
      &File.close(elem(&1, 0))
    )
  end

  @spec extract_jsons_from_binary(binary(), LogOffset.t(), LogOffset.t() | nil) ::
          Enumerable.t(String.t())
  defp extract_jsons_from_binary(binary, exclusive_min_offset, inclusive_max_offset, acc \\ [])
  defp extract_jsons_from_binary(<<>>, _, _, acc), do: {Enum.reverse(acc), ""}

  defp extract_jsons_from_binary(
         <<tx_offset1::64, op_offset1::64, key_size::32, _::binary-size(key_size), _::8, _flag::8,
           json_size::64, _::binary-size(json_size), rest::binary>>,
         %LogOffset{
           tx_offset: tx_offset2,
           op_offset: op_offset2
         } = log_offset,
         inclusive_max_offset,
         acc
       )
       when tx_offset1 < tx_offset2 or (tx_offset1 == tx_offset2 and op_offset1 <= op_offset2),
       do:
         extract_jsons_from_binary(
           rest,
           log_offset,
           inclusive_max_offset,
           acc
         )

  defp extract_jsons_from_binary(
         <<tx_offset1::64, op_offset1::64, key_size::32, _::binary-size(key_size), _::8, _flag::8,
           json_size::64, json::binary-size(json_size), _::binary>>,
         log_offset,
         %LogOffset{tx_offset: tx_offset2, op_offset: op_offset2} = inclusive_max_offset,
         acc
       )
       when tx_offset1 > tx_offset2 or (tx_offset1 == tx_offset2 and op_offset1 >= op_offset2),
       do:
         extract_jsons_from_binary(
           "",
           log_offset,
           inclusive_max_offset,
           [json | acc]
         )

  defp extract_jsons_from_binary(
         <<_::128, key_size::32, _::binary-size(key_size), _::8, _flag::8, json_size::64,
           json::binary-size(json_size), rest::binary>>,
         log_offset,
         inclusive_max_offset,
         acc
       ),
       do: extract_jsons_from_binary(rest, log_offset, inclusive_max_offset, [json | acc])

  defp extract_jsons_from_binary(rest, _, _, acc),
    do: {Enum.reverse(acc), rest}

  defp get_op_type(:insert), do: ?i
  defp get_op_type(:update), do: ?u
  defp get_op_type(:delete), do: ?d

  @doc "Serialize a non-infinite non-negative offset to a 16-byte binary"
  @spec offset(offset()) :: binary
  def offset(%LogOffset{tx_offset: tx_offset, op_offset: op_offset}),
    do: <<tx_offset::64, op_offset::64>>

  def offset({tx_offset, op_offset}), do: <<tx_offset::64, op_offset::64>>

  defp process_json(json) do
    json
    |> Jason.decode!()
    |> LogItems.keep_generic_headers()
    |> Jason.encode!()
  end

  @doc """
  Truncate the log file at the given persisted offset, starting the search from the given position.
  """
  def trim(log_file_path, search_start_pos, last_persisted_offset) do
    File.open!(log_file_path, [:raw, :read, :write, :read_ahead], fn file ->
      :file.position(file, search_start_pos)

      Stream.unfold(search_start_pos, fn position ->
        with <<tx_offset::64, op_offset::64, key_size::32>> <- IO.binread(file, 20),
             <<_::binary-size(key_size)>> <- IO.binread(file, key_size),
             <<_::8, _::8, json_size::64>> <- IO.binread(file, 10),
             <<_::binary-size(json_size)>> <- IO.binread(file, json_size) do
          read = 20 + key_size + json_size + 10
          {{LogOffset.new(tx_offset, op_offset), position + read, read}, position + read}
        else
          _ -> {{nil, position}, position}
        end
      end)
      |> Enum.find_value(fn
        {nil, position} -> position
        {offset, _, _} when is_log_offset_lt(offset, last_persisted_offset) -> false
        # On the persisted offset, trim what's after it
        {^last_persisted_offset, position, _} -> position
        # On an offset larger than the persisted offset, trim the line itself and the rest of the file
        {_, position, width} -> position - width
      end)
      |> then(&:file.position(file, &1))

      :file.truncate(file)
    end)
  end
end
