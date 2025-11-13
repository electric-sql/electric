defmodule Electric.ShapeCache.PureFileStorage.LogFile do
  @moduledoc false
  alias Electric.ShapeCache.PureFileStorage, as: PFS
  alias Electric.ShapeCache.PureFileStorage.ActionFile
  alias Electric.ShapeCache.PureFileStorage.KeyIndex
  alias Electric.ShapeCache.PureFileStorage.ActionFile
  alias Electric.ShapeCache.PureFileStorage.ChunkIndex
  alias Electric.LogItems
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker

  import Electric.Replication.LogOffset, only: :macros
  import Electric.ShapeCache.PureFileStorage, only: [stream_open_file!: 3]

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

  @spec make_entry(log_item_with_sizes()) :: {iodata(), iodata_size :: non_neg_integer()}
  def make_entry({offset, key_size, key, op_type, flag, json_size, json}) do
    {[
       LogOffset.to_int128(offset),
       <<key_size::32>>,
       key,
       <<op_type::8, flag::8, json_size::64>>,
       json
     ], key_size + json_size + @line_overhead}
  end

  @doc """
  Write a log file based on the stream of log items.
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
    |> KeyIndex.write_from_stream(log_file_path <> ".key_index", 1)
    |> Stream.map(fn
      {log_offset, key_size, key, op_type, flag, json_size, json} ->
        # Add processed flag (0 for unprocessed) to header
        [
          <<offset(log_offset)::binary, key_size::32, key::binary, op_type::8, flag::8,
            json_size::64>>,
          json
        ]
    end)
    |> Stream.into(File.stream!(log_file_path))
    |> Stream.run()

    {log_file_path, log_file_path <> ".chunk_index", log_file_path <> ".key_index"}
  end

  defp read_line(file) do
    with <<tx_offset::64, op_offset::64, key_size::32>> <- IO.binread(file, 20),
         <<key::binary-size(^key_size)>> <- IO.binread(file, key_size),
         <<op_type::8, processed_flag::8, json_size::64>> <- IO.binread(file, 10),
         <<json::binary-size(^json_size)>> <- IO.binread(file, json_size) do
      {LogOffset.new(tx_offset, op_offset), key_size, key, op_type, processed_flag, json_size,
       json}
    end
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

  def expected_position(current_position, key_size, json_size) do
    current_position + key_size + json_size + @line_overhead
  end

  @doc """
  Get the expected byte position of the JSON for the given log item after it's written.

  Used by other modules that know the log file structure.
  """
  @spec expected_json_position(non_neg_integer(), log_item_with_sizes() | non_neg_integer()) ::
          non_neg_integer()
  def expected_json_position(current_position, {_, key_size, _, _, _, _, _}) do
    current_position + key_size + @line_overhead
  end

  def expected_json_position(current_position, key_size) when is_integer(key_size) do
    current_position + key_size + @line_overhead
  end

  @spec stream_entries(
          log_file_path :: String.t(),
          start_position :: non_neg_integer(),
          excl_end_pos :: non_neg_integer() | :eof
        ) :: Enumerable.t({log_item_with_sizes(), non_neg_integer()})
  # compaction only
  def stream_entries(log_file_path, start_position, end_position \\ :eof) do
    Stream.resource(
      fn ->
        file = File.open!(log_file_path, [:read, :raw, :read_ahead])
        :file.position(file, start_position)
        {file, start_position}
      end,
      fn
        {file, position} when position >= end_position ->
          {:halt, {file, position}}

        {file, position} ->
          with <<tx_offset::64, op_offset::64, key_size::32>> <- IO.binread(file, 20),
               <<key::binary-size(^key_size)>> <- IO.binread(file, key_size),
               <<op_type::8, flag::8, json_size::64>> <- IO.binread(file, 10),
               <<json::binary-size(^json_size)>> <- IO.binread(file, json_size) do
            entry =
              {LogOffset.new(tx_offset, op_offset), key_size, key, op_type, flag, json_size, json}

            {[{entry, position}], {file, expected_position(position, entry)}}
          else
            _ -> {:halt, {file, position}}
          end
      end,
      &File.close(elem(&1, 0))
    )
  end

  def stream_jsons(
        %PFS{} = opts,
        log_file_path,
        start_position,
        end_position,
        exclusive_min_offset
      ) do
    # We can read ahead entire chunk into memory since chunk sizes are expected to be ~10MB by default,
    case stream_open_file!(opts, log_file_path, [:read, :raw]) do
      {:halt, :shape_gone} ->
        []

      {:ok, file} ->
        try do
          with {:ok, data} <- :file.pread(file, start_position, end_position - start_position) do
            {jsons, _} = extract_jsons_from_binary(data, exclusive_min_offset, nil)
            jsons
          else
            :eof ->
              raise "unexpected end of file"

            {:error, reason} ->
              raise File.Error,
                path: log_file_path,
                reason: reason,
                action: "pread(#{start_position}, #{end_position - start_position})"
          end
        after
          File.close(file)
        end
    end
  end

  def stream_jsons_until_offset(
        %PFS{} = opts,
        log_file_path,
        start_position,
        exclusive_min_offset,
        inclusive_max_offset
      ) do
    Stream.resource(
      fn ->
        case stream_open_file!(opts, log_file_path, [:read, :raw]) do
          {:ok, file} ->
            {:ok, ^start_position} = :file.position(file, start_position)
            {file, ""}

          {:halt, :shape_gone} ->
            :halt
        end
      end,
      fn
        :halt ->
          {:halt, []}

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
      fn
        [] -> :ok
        {file, _} -> File.close(file)
      end
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
             <<_::binary-size(^key_size)>> <- IO.binread(file, key_size),
             <<_::8, _::8, json_size::64>> <- IO.binread(file, 10),
             <<_::binary-size(^json_size)>> <- IO.binread(file, json_size) do
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

  alias Electric.LogItems

  def merge_with_actions(
        action_file_path,
        paths_with_labels,
        resulting_file,
        chunk_size,
        merge_fun \\ &LogItems.merge_updates/2
      ) do
    ActionFile.stream(action_file_path)
    |> Stream.transform(
      fn ->
        Map.new(paths_with_labels, fn {label, path} ->
          file = File.open!(path, [:read, :raw, :read_ahead])
          {label, file}
        end)
      end,
      # Actions are in log-offset order, so we can apply them as we go along
      fn {_offset, label, _entry_start, action}, files ->
        file = Map.fetch!(files, label)

        case action do
          :skip ->
            skip_line(file)
            {[], files}

          :keep ->
            {[file |> read_line() |> process_line()], files}

          {:compact, offsets} ->
            {[compact_lines(file, files, offsets, merge_fun)], files}
        end
      end,
      &Enum.each(&1, fn {_, file} -> File.close(file) end)
    )
    |> write_log_file(resulting_file, chunk_size)
  end

  defp skip_line(file) do
    _ = read_line(file)
    :ok
  end

  defp process_line({_, _, _, _, 1, _, _} = line), do: line

  defp process_line({offset, key_size, key, op_type, 0, _, json}) do
    new_json = process_json(json)
    {offset, key_size, key, op_type, 1, byte_size(new_json), new_json}
  end

  defp compact_lines(original_file, files, offsets, merge_fun) do
    # The line to be replaced with compaction will keep it's offset & key
    {offset, key_size, key, op_type, _, _, _} = read_line(original_file)

    # Save position
    saved_positions =
      Map.new(files, fn {label, file} ->
        {:ok, position} = :file.position(file, :cur)
        {label, position}
      end)

    merged_json =
      offsets
      # Group reads to be efficient, but try to limit loading the JSONs to 10MB at a time.
      # In the worst case when JSONs exceed 10MB, we'll just read one at a time.
      |> chunk_expected_reads(bytes: 1024 * 1024 * 10)
      |> Stream.flat_map(fn [{label, _, _} | _] = offsets ->
        file = Map.fetch!(files, label)
        read_offsets = Enum.map(offsets, fn {_, pos, length} -> {pos, length} end)

        case :file.pread(file, read_offsets) do
          {:ok, results} -> results
          {:error, reason} -> raise File.Error, path: original_file, reason: reason
          :eof -> raise "unexpected end of file while reading back jsons from the log"
        end
      end)
      |> Stream.map(&Jason.decode!/1)
      |> Enum.reduce(fn new, acc -> merge_fun.(acc, new) end)
      |> Jason.encode!()

    # Restore position to continue reading in the outer loop
    Enum.each(saved_positions, fn {label, position} ->
      :file.position(Map.fetch!(files, label), {:bof, position})
    end)

    {offset, key_size, key, op_type, 1, byte_size(merged_json), merged_json}
  end

  @spec chunk_expected_reads(
          Enumerable.t({position :: non_neg_integer(), size :: non_neg_integer()}),
          bytes: non_neg_integer()
        ) :: Enumerable.t(list({position :: non_neg_integer(), size :: non_neg_integer()}))
  defp chunk_expected_reads(stream, bytes: chunk_size) do
    Stream.chunk_while(
      stream,
      {nil, 0, []},
      fn
        {label, _, size} = item, {old_label, total_size, [_ | _] = acc}
        when total_size > chunk_size or old_label != label ->
          {:cont, Enum.reverse(acc), {label, size, [item]}}

        {label, _, size} = item, {_, total_size, acc} ->
          {:cont, {label, total_size + size, [item | acc]}}
      end,
      fn
        {_, _, []} -> {:cont, []}
        {_, _, acc} -> {:cont, Enum.reverse(acc), []}
      end
    )
  end
end
