defmodule Electric.ShapeCache.PureFileStorage.ChunkIndex do
  @moduledoc false
  alias Electric.ShapeCache.PureFileStorage.KeyIndex
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.PureFileStorage.FileInfo
  alias Electric.ShapeCache.PureFileStorage.LogFile
  alias Electric.ShapeCache.Storage
  alias Electric.Utils

  import Electric.Replication.LogOffset, only: :macros

  # bytes
  @full_record_width 64
  @half_record_width 32

  @doc """
  Return an nth chunk from the chunk index file.

  It returns the bounds of the chunk (if chunk is complete) and the positions of the log and key files
  for the chunk.

  In case the n is negative, it will return the nth chunk from the end of the file, where 0th chunk
  is the first chunk and -1 is the last chunk.

  If `only_complete?` is true, it will only return complete chunks, and skip the last incomplete chunk
  when positioning from the end of the file.

  If there's an incomplete write at the end of the file, this function will ignore it but won't error.
  """
  @spec get_nth_chunk(String.t(), integer(), only_complete?: boolean()) ::
          {:complete, bounds :: {LogOffset.t(), LogOffset.t()},
           log_file_position_range :: {non_neg_integer(), non_neg_integer()},
           key_file_position_range :: {non_neg_integer(), non_neg_integer()}}
          | {:incomplete, lower_bound :: LogOffset.t(),
             log_file_position_start :: non_neg_integer(),
             key_file_position_start :: non_neg_integer()}
          | :error
  def get_nth_chunk(path, n, opts \\ []) do
    only_complete? = Keyword.get(opts, :only_complete?, false)

    case FileInfo.file_size(path) do
      {:ok, chunk_file_size} ->
        chunk_count = div(chunk_file_size, @full_record_width)
        has_incomplete_chunk? = rem(chunk_file_size, @full_record_width) >= @half_record_width

        adjustment = if not only_complete? and has_incomplete_chunk?, do: 1, else: 0

        max = chunk_count - 1 + adjustment
        normal_n = if n < 0, do: max + n + 1, else: n

        cond do
          normal_n not in 0..max//1 ->
            :error

          normal_n == max and has_incomplete_chunk? ->
            read_incomplete_chunk(path, normal_n)

          true ->
            read_complete_chunk(path, normal_n)
        end

      {:error, :enoent} ->
        :error
    end
  end

  defp read_complete_chunk(path, n) do
    File.open!(path, [:read, :raw], fn file ->
      {:ok,
       <<tx1::64, op1::64, start_pos::64, key_start_pos::64, tx2::64, op2::64, end_pos::64,
         key_end_pos::64>>} =
        :file.pread(file, n * @full_record_width, @full_record_width)

      {:complete, {LogOffset.new(tx1, op1), LogOffset.new(tx2, op2)}, {start_pos, end_pos},
       {key_start_pos, key_end_pos}}
    end)
  end

  defp read_incomplete_chunk(path, n) do
    File.open!(path, [:read, :raw], fn file ->
      {:ok, <<tx::64, op::64, start_pos::64, key_start_pos::64>>} =
        :file.pread(file, n * @full_record_width, @half_record_width)

      {:incomplete, LogOffset.new(tx, op), start_pos, key_start_pos}
    end)
  end

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

  def get_last_boundary(_, 0), do: {:complete, LogOffset.last_before_real_offsets(), 0, 0}

  def get_last_boundary(chunk_file_path, chunk_file_size)
      when rem(chunk_file_size, @full_record_width) == 0 do
    File.open!(chunk_file_path, [:read, :raw], fn file ->
      {:ok, <<_::64*4, tx::64, op::64, end_pos::64, key_file_end_pos::64>>} =
        :file.pread(file, chunk_file_size - @full_record_width, @full_record_width)

      {:complete, LogOffset.new(tx, op), end_pos, key_file_end_pos}
    end)
  end

  def get_last_boundary(chunk_file_path, chunk_file_size)
      when rem(chunk_file_size, @full_record_width) == @half_record_width do
    File.open!(chunk_file_path, [:read, :raw], fn file ->
      {:ok, <<tx::64, op::64, start_pos::64, key_file_start_pos::64>>} =
        :file.pread(file, chunk_file_size - @half_record_width, @half_record_width)

      {:incomplete, LogOffset.new(tx, op), start_pos, key_file_start_pos}
    end)
  end

  def read_last_n_chunks(chunk_file_path, n) do
    size = file_size(chunk_file_path)
    full_chunks = div(size, @full_record_width)

    incomplete_chunk =
      if(rem(size, @full_record_width) >= @half_record_width, do: 1, else: 0)

    full_chunks_to_read = min(n - incomplete_chunk, full_chunks)
    full_chunks_to_skip = full_chunks - full_chunks_to_read

    File.open(chunk_file_path, [:read, :raw], fn file ->
      {:ok, [full_chunks_data, incomplete_chunk_data]} =
        :file.pread(
          file,
          [
            {full_chunks_to_skip * @full_record_width, full_chunks_to_read * @full_record_width},
            {full_chunks * @full_record_width, @half_record_width}
          ]
        )

      incomplete =
        case incomplete_chunk_data do
          :eof ->
            []

          <<tx::64, op::64, start_pos::64, key_start_pos::64>> ->
            [{{LogOffset.new(tx, op), nil}, {start_pos, nil}, {key_start_pos, nil}}]
        end

      full_chunks_data = if full_chunks_data == :eof, do: <<>>, else: full_chunks_data

      complete =
        for <<tx::64, op::64, start_pos::64, key_start_pos::64, tx2::64, op2::64, end_pos::64,
              key_end_pos::64 <- full_chunks_data>> do
          {{LogOffset.new(tx, op), LogOffset.new(tx2, op2)}, {start_pos, end_pos},
           {key_start_pos, key_end_pos}}
        end

      complete ++ incomplete
    end)
    |> case do
      {:ok, chunks} -> chunks
      {:error, :enoent} -> []
    end
  end

  defp file_size(chunk_file_path) do
    case FileInfo.file_size(chunk_file_path) do
      {:ok, size} -> size
      {:error, :enoent} -> 0
    end
  end

  @doc """
  Make sure that the chunk file doesn't end on a partial write and
  that the last chunk doesn't overshoot the new end of log.

  Returns position from which to seek in the main file.
  """
  @spec realign_and_trim(String.t(), LogOffset.t()) ::
          {log_file_search_start :: non_neg_integer(), key_file_search_start :: non_neg_integer()}
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

  defp trim(0, _, _), do: {0, 0}

  defp trim(file_size, chunk_file_path, last_persisted_offset) do
    case get_last_boundary(chunk_file_path, file_size) do
      {:incomplete, last_chunk_offset, start_pos, key_file_start_pos}
      when not is_log_offset_lt(last_persisted_offset, last_chunk_offset) ->
        {start_pos, key_file_start_pos}

      {:incomplete, _, _, _} ->
        FileInfo.truncate(chunk_file_path, file_size - @half_record_width)
        trim(file_size - @half_record_width, chunk_file_path, last_persisted_offset)

      {:complete, last_chunk_offset, end_pos, key_file_end_pos}
      when is_log_offset_lt(last_chunk_offset, last_persisted_offset) ->
        {end_pos, key_file_end_pos}

      {:complete, last_chunk_offset, _, _}
      when is_log_offset_lt(last_persisted_offset, last_chunk_offset) ->
        FileInfo.truncate(chunk_file_path, file_size - @half_record_width)
        trim(file_size - @half_record_width, chunk_file_path, last_persisted_offset)

      {:complete, ^last_persisted_offset, _, _} ->
        # We don't need to trim the chunk, but the search position must be from the start of this chunk
        File.open!(chunk_file_path, [:read, :raw], fn file ->
          {:ok, <<_::64*2, start_pos::64, key_start_pos::64, _::64*4>>} =
            :file.pread(file, file_size - @full_record_width, @full_record_width)

          {start_pos, key_start_pos}
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
  def fetch_chunk(path, exclusive_min_offset) do
    case fetch_chunk_with_positions(path, exclusive_min_offset) do
      {:ok, {_, nil}, {start_pos, nil}, _} ->
        {:ok, nil, {start_pos, nil}}

      {:ok, {_, max_offset}, {start_pos, end_pos}, _} ->
        {:ok, max_offset, {start_pos, end_pos}}

      :error ->
        :error
    end
  end

  defp fetch_chunk_with_positions(chunk_file_path, %LogOffset{} = exclusive_min_offset) do
    file = File.open!(chunk_file_path, [:read, :raw])

    try do
      {:ok, size} = :file.position(file, :eof)

      file_complete? = rem(size, @full_record_width) == 0
      :file.advise(file, 0, size, :random)

      case do_binary_search(file, 0, div(size, @full_record_width) - 1, exclusive_min_offset) do
        {:ok, _, _, _} = result ->
          result

        nil ->
          if file_complete?,
            do: :error,
            else: read_last_partial_chunk(file, size)
      end
    after
      File.close(file)
    end
  rescue
    err in [File.Error] ->
      message = "Could not open chunk index file #{chunk_file_path}: #{inspect(err.reason)}"
      reraise Storage.Error, [message: message], __STACKTRACE__
  end

  defp read_last_partial_chunk(file, size) do
    {:ok, <<min_tx::64, min_op::64, start_pos::64, key_start_pos::64>>} =
      :file.pread(file, size - @half_record_width, @half_record_width)

    {:ok, {LogOffset.new(min_tx, min_op), nil}, {start_pos, nil}, {key_start_pos, nil}}
  end

  defp do_binary_search(file, left, right, %LogOffset{} = target)
       when left <= right do
    mid = div(left + right, 2)

    {:ok,
     <<min_tx::64, min_op::64, start_pos::64, key_start_pos::64, max_tx::64, max_op::64,
       end_pos::64,
       key_end_pos::64>>} =
      :file.pread(file, mid * @full_record_width, @full_record_width)

    max_offset = LogOffset.new(max_tx, max_op)
    min_offset = LogOffset.new(min_tx, min_op)

    case {LogOffset.compare(target, max_offset), mid} do
      {:lt, mid} when mid > 0 ->
        # Target is less than max_offset, this chunk might be the answer
        # but let's check if there's a better one in the left half
        do_binary_search(file, left, mid - 1, target) ||
          {:ok, {min_offset, max_offset}, {start_pos, end_pos}, {key_start_pos, key_end_pos}}

      {:lt, _} ->
        {:ok, {min_offset, max_offset}, {start_pos, end_pos}, {key_start_pos, key_end_pos}}

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
          {offset_boundaries :: {LogOffset.t(), LogOffset.t()},
           log_file_positions :: {non_neg_integer(), non_neg_integer()},
           key_file_positions :: {non_neg_integer(), non_neg_integer()}}
          | {{LogOffset.t(), nil}, {non_neg_integer(), nil}, {non_neg_integer(), nil}}
        ]
  def read_chunk_file(path) do
    File.open!(path, [:read, :raw], fn file ->
      Stream.unfold(file, fn file ->
        case :file.read(file, @full_record_width) do
          {:ok,
           <<min_tx::64, min_op::64, start_pos::64, key_start_pos::64, max_tx::64, max_op::64,
             end_pos::64, key_end_pos::64>>} ->
            {{{LogOffset.new(min_tx, min_op), LogOffset.new(max_tx, max_op)},
              {start_pos, end_pos}, {key_start_pos, key_end_pos}}, file}

          {:ok, <<min_tx::64, min_op::64, start_pos::64, key_start_pos::64>>} ->
            {{{LogOffset.new(min_tx, min_op), nil}, {start_pos, nil}, {key_start_pos, nil}}, file}

          :eof ->
            nil
        end
      end)
      |> Enum.to_list()
    end)
  end

  @doc """
  Write a chunk index from the stream of log items to the given path.

  This funciton isn't meant to be used for live writes, it's only for writing
  the chunk index if we're writing full log file at once, at compaction.
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
      # agg is {file, write_position, key_file_write_pos, byte_count, last_seen_offset}
      fn -> {File.open!(path, [:write, :raw]), 0, 0, 0, nil} end,
      fn {offset, _, _, _, _, json_size, _} = line,
         {file, write_position, key_file_write_pos, byte_count, last_seen_offset} ->
        # Start the chunk if there's no last offset
        if is_nil(last_seen_offset),
          do:
            IO.binwrite(
              file,
              <<LogOffset.to_int128(offset)::binary, write_position::64, key_file_write_pos::64>>
            )

        log_pos_after_write = LogFile.expected_position(write_position, line)
        key_file_write_pos = KeyIndex.expected_position(key_file_write_pos, line)

        # We're counting bytes only on JSON payloads that are actually sent to the client
        case LogChunker.fit_into_chunk(json_size, byte_count, chunk_size) do
          {:ok, new_size} ->
            {file, log_pos_after_write, key_file_write_pos, new_size, offset}

          {:threshold_exceeded, 0} ->
            # Chunk ended, finish writing the entry
            IO.binwrite(
              file,
              <<LogOffset.to_int128(offset)::binary, log_pos_after_write::64,
                key_file_write_pos::64>>
            )

            {file, log_pos_after_write, key_file_write_pos, 0, nil}
        end
      end,
      fn {file, pos, key_pos, _, last_offset} = acc ->
        # Finish writing the last entry if there is one
        if finish_last_entry? and not is_nil(last_offset),
          do:
            IO.binwrite(file, <<LogOffset.to_int128(last_offset)::binary, pos::64, key_pos::64>>)

        acc
      end,
      &File.close(elem(&1, 0))
    )
  end

  def make_full_entry({min, max}, {log_start, log_end}, {key_start, key_end}) do
    <<LogOffset.to_int128(min)::binary, log_start::64, key_start::64,
      LogOffset.to_int128(max)::binary, log_end::64, key_end::64>>
  end

  def make_half_entry(min, log_start, key_start) do
    <<LogOffset.to_int128(min)::binary, log_start::64, key_start::64>>
  end

  def copy_adjusting_positions(source, target, offset, log_adj, key_adj)
      when log_adj <= 0 and key_adj <= 0 do
    # Chunk files are expected to be fairly small & sparse (10MiB chunk file would correspond to ~1.6TB of log data)
    # So we're going to read the whole file into memory and then write it back, because it'll be faster
    source
    |> read_chunk_file()
    |> Stream.map(fn
      {{_, max}, _, _} when is_log_offset_lte(max, offset) ->
        []

      {{min, max} = offsets, {log_start, log_end}, {key_start, key_end}}
      when is_log_offset_lte(offset, min) and max != nil ->
        make_full_entry(
          offsets,
          {log_start + log_adj, log_end + log_adj},
          {key_start + key_adj, key_end + key_adj}
        )

      {{min, nil}, {log_start, nil}, {key_start, nil}} when is_log_offset_lte(offset, min) ->
        make_half_entry(min, log_start + log_adj, key_start + key_adj)

      {{_, max}, {_, log_end}, {_, key_end}} when max != nil ->
        # Adjustment to middle of chunk, can happen only on the first chunk
        make_full_entry({offset, max}, {0, log_end + log_adj}, {0, key_end + key_adj})

      {{min, nil}, _, _} ->
        # Adjustment to middle of last chunk
        make_half_entry(min, 0, 0)
    end)
    |> Stream.into(File.stream!(target, [:delayed_write]))
    |> Stream.run()
  end
end
