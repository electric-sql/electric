defmodule Electric.ShapeCache.PureFileStorage.ChunkIndex do
  @moduledoc false
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.PureFileStorage.FileInfo
  alias Electric.ShapeCache.PureFileStorage.LogFile
  alias Electric.ShapeCache.Storage
  alias Electric.Utils

  import Electric.Replication.LogOffset, only: :macros

  # bytes
  @full_record_width 48
  @half_record_width 24

  @doc """
  Get the most upper bounding position available in this chunk file along
  with the chunk completeness marker

  If last chunk is complete, returns the closing position.
  If last chunk is not complete, returns the opening position.
  """
  def get_last_boundary(chunk_file_path) do
    case FileInfo.file_size(chunk_file_path) do
      {:ok, size} -> get_last_boundary(chunk_file_path, size)
      {:error, :enoent} -> get_last_boundary(chunk_file_path, 0)
    end
  end

  def get_last_boundary(_, 0), do: {:complete, LogOffset.last_before_real_offsets(), 0}

  def get_last_boundary(chunk_file_path, chunk_file_size)
      when rem(chunk_file_size, @full_record_width) == 0 do
    File.open!(chunk_file_path, [:read, :raw], fn file ->
      {:ok, <<_::64*3, tx::64, op::64, end_pos::64>>} =
        :file.pread(file, chunk_file_size - @full_record_width, @full_record_width)

      {:complete, LogOffset.new(tx, op), end_pos}
    end)
  end

  def get_last_boundary(chunk_file_path, chunk_file_size)
      when rem(chunk_file_size, @full_record_width) == @half_record_width do
    File.open!(chunk_file_path, [:read, :raw], fn file ->
      {:ok, <<tx::64, op::64, start_pos::64>>} =
        :file.pread(file, chunk_file_size - @half_record_width, @half_record_width)

      {:incomplete, LogOffset.new(tx, op), start_pos}
    end)
  end

  @doc """
  Make sure that the chunk file doesn't end on a partial write and
  that the last chunk doesn't overshoot the new end of log.

  Returns position from which to seek in the main file.
  """
  def realign_and_trim(chunk_file_path, last_persisted_offset) do
    case FileInfo.file_size(chunk_file_path) do
      {:error, :enoent} ->
        0

      {:ok, size} when rem(size, @half_record_width) == 0 ->
        size

      {:ok, size} ->
        FileInfo.truncate(chunk_file_path, size - rem(size, @half_record_width))
        size - rem(size, @half_record_width)
    end
    |> trim(chunk_file_path, last_persisted_offset)
  end

  defp trim(0, _, _), do: 0

  defp trim(file_size, chunk_file_path, last_persisted_offset) do
    case get_last_boundary(chunk_file_path, file_size) do
      {:incomplete, last_chunk_offset, start_pos}
      when not is_log_offset_lt(last_persisted_offset, last_chunk_offset) ->
        start_pos

      {:incomplete, _, _} ->
        FileInfo.truncate(chunk_file_path, file_size - @half_record_width)
        trim(file_size - @half_record_width, chunk_file_path, last_persisted_offset)

      {:complete, last_chunk_offset, end_pos}
      when is_log_offset_lt(last_chunk_offset, last_persisted_offset) ->
        end_pos

      {:complete, last_chunk_offset, _}
      when is_log_offset_lt(last_persisted_offset, last_chunk_offset) ->
        FileInfo.truncate(chunk_file_path, file_size - @half_record_width)
        trim(file_size - @half_record_width, chunk_file_path, last_persisted_offset)

      {:complete, ^last_persisted_offset, _} ->
        # We don't need to trim the chunk, but the search position must be from the start of this chunk
        File.open!(chunk_file_path, [:read, :raw], fn file ->
          {:ok, <<_::64*2, start_pos::64, _::64*3>>} =
            :file.pread(file, file_size - @full_record_width, @full_record_width)

          start_pos
        end)
    end
  end

  @doc """
  For a given chunk index, find the chunk that contains the first
  offset greater than the given one.

  Returns the max offset of the found chunk and reading boundaries for the log file.
  """
  @spec fetch_chunk(path :: String.t(), LogOffset.t()) ::
          {:ok, max_offset :: LogOffset.t(),
           {start_position :: non_neg_integer, end_position :: non_neg_integer}}
          | {:ok, nil, {start_position :: non_neg_integer, nil}}
          | :error
  def fetch_chunk(chunk_file_path, %LogOffset{} = exclusive_min_offset) do
    file = File.open!(chunk_file_path, [:read, :raw])

    try do
      {:ok, size} = :file.position(file, :eof)

      file_complete? = rem(size, @full_record_width) == 0
      :file.advise(file, 0, size, :random)

      case do_binary_search(file, 0, div(size, @full_record_width) - 1, exclusive_min_offset) do
        {:ok, max_offset, start_pos, end_pos} ->
          {:ok, max_offset, {start_pos, end_pos}}

        nil ->
          if file_complete?,
            do: :error,
            else: {:ok, nil, {get_last_chunk_start_pos(file, size), nil}}
      end
    after
      File.close(file)
    end
  rescue
    File.Error ->
      reraise Storage.Error,
              [message: "Could not open chunk index file #{chunk_file_path}"],
              __STACKTRACE__
  end

  defp get_last_chunk_start_pos(file, size) do
    {:ok, <<_min_tx::64, _min_op::64, start_pos::64>>} =
      :file.pread(file, size - div(@full_record_width, 2), div(@full_record_width, 2))

    start_pos
  end

  defp do_binary_search(file, left, right, %LogOffset{} = target)
       when left <= right do
    mid = div(left + right, 2)

    {:ok, <<_min_tx::64, _min_op::64, start_pos::64, max_tx::64, max_op::64, end_pos::64>>} =
      :file.pread(file, mid * @full_record_width, @full_record_width)

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

  @doc """
  Read all chunks from the chunk index file.

  Last unclosed chunk will have nil as upper log offset and as upper position
  """
  @spec read_chunk_file(String.t()) :: [
          {{LogOffset.t(), LogOffset.t()}, {non_neg_integer(), non_neg_integer()}}
          | {{LogOffset.t(), nil}, {non_neg_integer(), nil}}
        ]
  def read_chunk_file(path) do
    File.open!(path, [:read, :raw], fn file ->
      Stream.unfold(file, fn file ->
        case :file.read(file, @full_record_width) do
          {:ok, <<min_tx::64, min_op::64, start_pos::64, max_tx::64, max_op::64, end_pos::64>>} ->
            {{{LogOffset.new(min_tx, min_op), LogOffset.new(max_tx, max_op)},
              {start_pos, end_pos}}, file}

          {:ok, <<min_tx::64, min_op::64, start_pos::64>>} ->
            {{{LogOffset.new(min_tx, min_op), nil}, {start_pos, nil}}, file}

          :eof ->
            nil
        end
      end)
      |> Enum.to_list()
    end)
  end

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
  def write_from_stream(stream, path, chunk_size, opts \\ []) do
    finish_last_entry? = Keyword.get(opts, :finish_last_entry?, true)

    Utils.stream_add_side_effect(
      stream,
      # agg is {file, write_position, byte_count, last_seen_offset}
      fn -> {File.open!(path, [:write, :raw]), 0, 0, nil} end,
      fn {offset, _, _, _, _, json_size, _} = line,
         {file, write_position, byte_count, last_seen_offset} ->
        # Start the chunk if there's no last offset
        if is_nil(last_seen_offset),
          do: IO.binwrite(file, <<LogOffset.to_int128(offset)::binary, write_position::64>>)

        position_after_write = LogFile.expected_position(write_position, line)

        # We're counting bytes only on JSON payloads that are actually sent to the client
        case LogChunker.fit_into_chunk(json_size, byte_count, chunk_size) do
          {:ok, new_size} ->
            {file, position_after_write, new_size, offset}

          {:threshold_exceeded, 0} ->
            # Chunk ended, finish writing the entry
            IO.binwrite(file, <<LogOffset.to_int128(offset)::binary, position_after_write::64>>)

            {file, position_after_write, 0, nil}
        end
      end,
      fn {file, pos, _, last_offset} = acc ->
        # Finish writing the last entry if there is one
        if finish_last_entry? and not is_nil(last_offset),
          do: IO.binwrite(file, <<LogOffset.to_int128(last_offset)::binary, pos::64>>)

        acc
      end,
      &File.close(elem(&1, 0))
    )
  end
end
