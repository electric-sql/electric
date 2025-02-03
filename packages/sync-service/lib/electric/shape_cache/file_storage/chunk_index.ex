defmodule Electric.ShapeCache.FileStorage.ChunkIndex do
  @moduledoc false

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker
  alias Electric.Utils
  alias Electric.ShapeCache.FileStorage.LogFile

  # 16 bytes offset + 8 bytes position + 16 bytes offset + 8 bytes position = 48 bytes
  @chunk_entry_size 48

  @doc """
  Write a chunk index from the stream of log items to the given path.

  A chunk index serves two purposes: it acts as a sparse index for the log file
  and chunks are used to align client reads to benefit CDN cache hits.

  The format of the file is:

      <<first_offset::128, first_position::64, last_offset::128, last_position::64>>

  Fixed byte width entries give us an opportunity to use binary search.
  """
  @spec write_from_stream(
          Enumerable.t(LogFile.log_item_with_sizes()),
          path :: String.t(),
          chunk_size :: non_neg_integer
        ) :: Enumerable.t(LogFile.log_item_with_sizes())
  def write_from_stream(stream, path, chunk_size) do
    Utils.stream_add_side_effect(
      stream,
      # agg is {file, write_position, byte_count, last_seen_offset}
      fn -> {File.open!(path, [:write, :raw]), 0, 0, nil} end,
      fn {offset, _, _, _, _, json_size, _} = line,
         {file, write_position, byte_count, last_seen_offset} ->
        # Start the chunk if there's no last offset
        if is_nil(last_seen_offset),
          do: IO.binwrite(file, <<LogFile.offset(offset)::binary, write_position::64>>)

        position_after_write = LogFile.expected_position(write_position, line)

        # We're counting bytes only on JSON payloads that are actually sent to the client
        case LogChunker.fit_into_chunk(json_size, byte_count, chunk_size) do
          {:ok, new_size} ->
            {file, position_after_write, new_size, offset}

          {:threshold_exceeded, 0} ->
            # Chunk ended, finish writing the entry
            IO.binwrite(file, <<LogFile.offset(offset)::binary, position_after_write::64>>)

            {file, position_after_write, 0, nil}
        end
      end,
      fn {file, pos, _, last_offset} = acc ->
        # Finish writing the last entry if there is one
        if not is_nil(last_offset),
          do: IO.binwrite(file, <<LogFile.offset(last_offset)::binary, pos::64>>)

        acc
      end,
      &File.close(elem(&1, 0))
    )
  end

  @doc """
  For a given chunk index, find the chunk that contains the first
  offset greater than the given one.

  Returns the max offset of the found chunk and reading boundaries for the log file.
  """
  @spec fetch_chunk(path :: String.t(), LogOffset.t()) ::
          {:ok, max_offset :: LogOffset.t(),
           {start_position :: non_neg_integer, end_position :: non_neg_integer}}
          | :error
  def fetch_chunk(chunk_file_path, %LogOffset{} = exclusive_min_offset) do
    file = File.open!(chunk_file_path, [:read, :raw])
    {:ok, size} = :file.position(file, :eof)

    try do
      case do_binary_search(file, 0, div(size, @chunk_entry_size) - 1, exclusive_min_offset) do
        {:ok, max_offset, start_pos, end_pos} -> {:ok, max_offset, {start_pos, end_pos}}
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

    max_offset = LogOffset.new(max_tx, max_op)

    case {LogOffset.compare(target, max_offset), mid} do
      {:lt, mid} when mid > 0 ->
        # Target is less than max_offset, this chunk might be the answer
        # but let's check if there's a better one in the left half
        do_binary_search(file, left, mid - 1, target) || {:ok, max_offset, start_pos, end_pos}

      {:lt, _} ->
        {:ok, max_offset, start_pos, end_pos}

      {_, mid} when mid < right ->
        # Target is equal to / greater than max_offset, need to look in right half
        do_binary_search(file, mid + 1, right, target)

      _ ->
        # Target is greater than max_offset but we're at the end
        nil
    end
  end

  defp do_binary_search(_file, _left, _right, _target), do: nil
end
