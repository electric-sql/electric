defmodule Electric.ShapeCache.PureFileStorage.WriteLoop do
  @moduledoc false
  # This module encapsulates the write loop of the PureFileStorage, and is responsible for
  # appending log lines to the log and flushing the buffer to disk.
  # There are many steps to this, so it's split out into a separate module.

  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.PureFileStorage
  alias Electric.ShapeCache.PureFileStorage.ChunkIndex
  alias Electric.ShapeCache.PureFileStorage.LogFile
  alias Electric.Replication.LogOffset
  import Electric.Replication.LogOffset
  import Record
  import Electric.ShapeCache.PureFileStorage.SharedRecords

  defrecord :open_files,
    json_file: nil,
    chunk_file: nil

  # Record that controls the writer's progress & flush logic
  defrecord :writer_acc,
    ets_line_buffer: [],
    buffer: [],
    buffer_size: 0,
    last_seen_offset: LogOffset.last_before_real_offsets(),
    last_seen_txn_offset: LogOffset.last_before_real_offsets(),
    last_persisted_offset: LogOffset.last_before_real_offsets(),
    last_persisted_txn_offset: LogOffset.last_before_real_offsets(),
    write_position: 0,
    bytes_in_chunk: 0,
    times_flushed: 0,
    chunk_started?: false,
    cached_chunk_boundaries: {LogOffset.last_before_real_offsets(), []},
    open_files: {:open_files, nil, nil}

  defguardp is_chunk_file_open(acc)
            when elem(acc, 0) == :writer_acc and
                   elem(elem(acc, writer_acc(:open_files)), open_files(:chunk_file)) != nil

  def last_persisted_txn_offset(writer_acc(last_persisted_txn_offset: res)), do: res
  def last_seen_offset(writer_acc(last_seen_offset: res)), do: res
  def cached_chunk_boundaries(writer_acc(cached_chunk_boundaries: res)), do: res
  def has_flushed_since?(writer_acc(times_flushed: res), previous_ref), do: res != previous_ref
  def times_flushed(writer_acc(times_flushed: res)), do: res

  def adjust_write_positions(
        writer_acc(write_position: write_position),
        log_file_pos
      ) do
    writer_acc(write_position: write_position + log_file_pos)
  end

  @doc """
  Initialize the writer from disk. At the point of recovery, all offsets are assumed to be the same - last txn boundary.
  """
  def init_from_disk(opts) do
    last_persisted_txn_offset = Keyword.fetch!(opts, :last_persisted_txn_offset)
    write_position = Keyword.fetch!(opts, :write_position)
    bytes_in_chunk = Keyword.fetch!(opts, :bytes_in_chunk)
    chunk_started? = Keyword.fetch!(opts, :chunk_started?)
    chunks = Keyword.fetch!(opts, :chunks)

    writer_acc(
      last_persisted_offset: last_persisted_txn_offset,
      last_persisted_txn_offset: last_persisted_txn_offset,
      last_seen_offset: last_persisted_txn_offset,
      last_seen_txn_offset: last_persisted_txn_offset,
      write_position: write_position,
      bytes_in_chunk: bytes_in_chunk,
      chunk_started?: chunk_started?,
      cached_chunk_boundaries: chunks
    )
  end

  @doc """
  Flush the buffer (if any) and close all files
  """
  def flush_and_close_all(writer_acc(open_files: open_files) = acc, state) do
    acc = flush_buffer(acc, state)

    Tuple.to_list(open_files)
    |> Enum.reject(&is_nil/1)
    |> Enum.each(&File.close/1)

    writer_acc(acc, open_files: open_files())
  end

  @doc """
  Append log lines from a transaction fragment.

  Unlike `append_to_log!/3`, this does NOT advance `last_seen_txn_offset` or
  call `register_complete_txn`. Transaction completion should be signaled
  separately via `register_complete_txn/2` after the commit is received.

  This ensures that on crash/recovery, `fetch_latest_offset` returns the
  last committed transaction offset, not a mid-transaction offset.
  """
  def append_fragment_to_log!(txn_lines, writer_acc(times_flushed: times_flushed) = acc, state) do
    acc = ensure_json_file_open(acc, state)

    txn_lines
    |> Enum.reduce(acc, fn
      {offset, _, _, _, _, _, _}, writer_acc(last_seen_txn_offset: min_offset) = acc
      when is_log_offset_lte(offset, min_offset) ->
        # Line already persisted, no-op
        acc

      {offset, _, _, _, _, _, _} = line, acc ->
        acc
        |> maybe_write_opening_chunk_boundary(state, offset)
        |> add_to_buffer(line)
        |> maybe_write_closing_chunk_boundary(state)
        |> maybe_flush_buffer(state)
    end)
    |> close_chunk_file()
    |> case do
      # If the buffer has been fully flushed, no need to schedule more flushes
      writer_acc(buffer_size: 0) = acc -> {acc, cancel_flush_timer: true}
      acc -> {acc, schedule_flush: times_flushed}
    end
  end

  @doc """
  Append a stream of log lines to the log.
  """
  def append_to_log!(txn_lines, acc, state) do
    {acc, opts} = append_fragment_to_log!(txn_lines, acc, state)
    {finalize_txn(acc, state), opts}
  end

  ### Working with the buffer

  defp add_to_buffer(
         writer_acc(
           buffer: buffer,
           buffer_size: buffer_size,
           write_position: write_position,
           ets_line_buffer: ets_line_buffer,
           bytes_in_chunk: bytes_in_chunk
         ) =
           acc,
         {offset, _, _, _, _, json_size, json} = line
       ) do
    {iodata, iodata_size} = LogFile.make_entry(line)

    writer_acc(acc,
      buffer: [buffer | iodata],
      ets_line_buffer: [{LogOffset.to_tuple(offset), json} | ets_line_buffer],
      buffer_size: buffer_size + iodata_size,
      write_position: write_position + iodata_size,
      bytes_in_chunk: bytes_in_chunk + json_size,
      last_seen_offset: offset
    )
  end

  ### Working with chunk boundaries

  defp maybe_write_opening_chunk_boundary(writer_acc(chunk_started?: true) = acc, _, _), do: acc

  defp maybe_write_opening_chunk_boundary(
         writer_acc(write_position: pos) = acc,
         writer_state(opts: opts) = state,
         offset
       ) do
    writer_acc(acc, chunk_started?: true)
    |> ensure_chunk_file_open(state)
    |> write_to_chunk_file(ChunkIndex.make_half_entry(offset, pos, 0))
    |> add_opening_chunk_boundary_to_cache(offset, pos)
    |> update_chunk_boundaries_cache(opts)
  end

  defp maybe_write_closing_chunk_boundary(
         writer_acc(bytes_in_chunk: total) = acc,
         writer_state(opts: %{chunk_bytes_threshold: maximum})
       )
       when total < maximum,
       do: acc

  defp maybe_write_closing_chunk_boundary(
         writer_acc(last_seen_offset: offset, write_position: position) = acc,
         writer_state(opts: opts) = state
       ) do
    writer_acc(acc, chunk_started?: false, bytes_in_chunk: 0)
    |> ensure_chunk_file_open(state)
    |> write_to_chunk_file(ChunkIndex.make_half_entry(offset, position, 0))
    |> add_closing_chunk_boundary_to_cache(offset, position)
    |> update_chunk_boundaries_cache(opts)
    |> flush_buffer(state)
  end

  defp write_to_chunk_file(
         writer_acc(open_files: open_files(chunk_file: chunk_file)) = acc,
         entry
       )
       when not is_nil(chunk_file) do
    IO.binwrite(chunk_file, entry)
    acc
  end

  ### Working with chunk boundaries cache

  # We're keeping at most 3 latest chunks in memory. Adding a new one pushes the oldest one out
  defp add_opening_chunk_boundary_to_cache(
         writer_acc(cached_chunk_boundaries: {boundary, cached_chunks}) = acc,
         offset,
         pos
       )
       when length(cached_chunks) < 3 do
    writer_acc(acc,
      cached_chunk_boundaries: {boundary, cached_chunks ++ [{{offset, nil}, {pos, nil}}]}
    )
  end

  defp add_opening_chunk_boundary_to_cache(
         writer_acc(cached_chunk_boundaries: {_, [{{_, max}, _} | cached_chunks]}) = acc,
         offset,
         pos
       ) do
    writer_acc(acc,
      cached_chunk_boundaries: {max, cached_chunks ++ [{{offset, nil}, {pos, nil}}]}
    )
  end

  defp add_closing_chunk_boundary_to_cache(
         writer_acc(cached_chunk_boundaries: {boundary, cached_chunks}) = acc,
         max,
         end_pos
       ) do
    [{{min, nil}, {start_pos, nil}} | rest] = Enum.reverse(cached_chunks)

    writer_acc(acc,
      cached_chunk_boundaries:
        {boundary, Enum.reverse([{{min, max}, {start_pos, end_pos}} | rest])}
    )
  end

  defp update_chunk_boundaries_cache(writer_acc(cached_chunk_boundaries: cached) = acc, opts) do
    PureFileStorage.update_chunk_boundaries_cache(opts, cached)
    acc
  end

  ### Working with files

  defp ensure_json_file_open(writer_acc(open_files: open_files(json_file: x)) = acc, _state)
       when not is_nil(x),
       do: acc

  defp ensure_json_file_open(
         writer_acc(open_files: open_files(json_file: nil) = open_files) = acc,
         state
       ) do
    files = open_files(open_files, json_file: open_file(state, :json_file))

    writer_acc(acc, open_files: files)
  end

  defp ensure_chunk_file_open(writer_acc(open_files: open_files(chunk_file: x)) = acc, _state)
       when not is_nil(x),
       do: acc

  defp ensure_chunk_file_open(
         writer_acc(open_files: open_files(chunk_file: nil) = open_files) = acc,
         state
       ) do
    files = open_files(open_files, chunk_file: open_file(state, :chunk_file))

    writer_acc(acc, open_files: files)
  end

  defp close_chunk_file(writer_acc() = acc) when not is_chunk_file_open(acc), do: acc

  defp close_chunk_file(
         writer_acc(open_files: open_files(chunk_file: chunk_file) = open_files) = acc
       ) do
    File.close(chunk_file)
    writer_acc(acc, open_files: open_files(open_files, chunk_file: nil))
  end

  defdelegate open_file(state, type), to: PureFileStorage

  ### Working with ets

  defp maybe_store_lines_in_ets(writer_acc(buffer_size: 0) = acc, _state), do: acc

  defp maybe_store_lines_in_ets(
         writer_acc(ets_line_buffer: buffer) = acc,
         writer_state(ets: ets) = state
       ) do
    :ets.insert(ets, buffer)

    update_persistance_metadata(acc, state)
  end

  defp trim_ets(writer_acc() = acc, writer_state(ets: ets)) do
    :ets.delete_all_objects(ets)
    acc
  end

  ### Working with flush

  @delayed_write 64 * 1024
  defp maybe_flush_buffer(writer_acc(buffer_size: size) = acc, state) when size >= @delayed_write,
    do: flush_buffer(acc, state)

  defp maybe_flush_buffer(acc, _), do: acc

  @doc """
  Flush the buffer if it's not empty
  """
  def flush_buffer(writer_acc(buffer_size: 0) = acc, _state) do
    acc
  end

  def flush_buffer(
        writer_acc(
          buffer: buffer,
          last_seen_offset: last_seen_offset,
          last_seen_txn_offset: last_seen_txn,
          last_persisted_txn_offset: last_persisted_txn,
          times_flushed: times_flushed,
          open_files: open_files(json_file: json_file)
        ) = acc,
        state
      ) do
    IO.binwrite(json_file, buffer)
    :file.datasync(json_file)

    # Tell the parent process that we've flushed up to this point
    send(self(), {Storage, :flushed, last_seen_offset})

    # Because we've definitely persisted everything up to this point, we can remove all in-memory lines from ETS
    writer_acc(acc,
      buffer: [],
      buffer_size: 0,
      ets_line_buffer: [],
      last_persisted_offset: last_seen_offset,
      last_persisted_txn_offset: last_seen_txn,
      times_flushed: times_flushed + 1
    )
    |> update_persistance_metadata(state, last_persisted_txn)
    |> trim_ets(state)
  end

  defp update_persistance_metadata(
         writer_acc(
           last_persisted_txn_offset: last_persisted_txn,
           last_persisted_offset: last_persisted_offset,
           last_seen_txn_offset: last_seen_txn
         ) = acc,
         writer_state(opts: opts),
         old_last_persisted_txn_offset \\ nil
       ) do
    PureFileStorage.update_global_persistence_information(
      opts,
      last_persisted_txn,
      last_persisted_offset,
      last_seen_txn,
      old_last_persisted_txn_offset
    )

    acc
  end

  # This helper function must be called after the last log items of a transaction has been
  # written. It ensures that txn offset is advanced forward in the writer state.
  defp finalize_txn(acc, state) do
    writer_acc(last_seen_offset: offset) = acc

    acc
    |> writer_acc(last_seen_txn_offset: offset)
    |> maybe_store_lines_in_ets(state)
    |> register_complete_txn(state)
  end

  defp register_complete_txn(
         writer_acc(
           last_seen_offset: last_seen,
           last_persisted_offset: last_persisted,
           last_persisted_txn_offset: prev_persisted_txn
         ) = acc,
         state
       ) do
    if last_seen == last_persisted do
      writer_acc(acc, last_persisted_txn_offset: last_seen, last_seen_txn_offset: last_seen)
    else
      writer_acc(acc, last_seen_txn_offset: last_seen)
    end
    |> update_persistance_metadata(state, prev_persisted_txn)
  end

  @doc """
  Signal that a transaction has been committed.

  This updates `last_seen_txn_offset` and potentially `last_persisted_txn_offset`
  to mark the transaction as complete. Should be called after all fragments
  have been written via `append_fragment_to_log!/3`.
  """
  def signal_txn_commit(acc, state) do
    finalize_txn(acc, state)
  end
end
