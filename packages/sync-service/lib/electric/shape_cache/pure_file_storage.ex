defmodule Electric.ShapeCache.PureFileStorage do
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.PureFileStorage.ChunkIndex
  alias Electric.ShapeCache.PureFileStorage.FileInfo
  alias Electric.ShapeCache.PureFileStorage.LogFile
  alias Electric.ShapeCache.PureFileStorage.Snapshot
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Shape
  import LogOffset
  import Record

  @behaviour Electric.ShapeCache.Storage

  # Record that's stored in the stack-wide ETS table for reader reference
  defrecord :storage_meta, [
    :shape_handle,
    :ets_table,
    :persisted_full_txn_offset,
    :last_persisted_offset,
    :last_seen_txn_offset
  ]

  # Record that controls the writer's progress & flush logic
  defrecord :writer_acc,
    buffer: [],
    ets_line_buffer: [],
    buffer_size: 0,
    last_seen_offset: LogOffset.last_before_real_offsets(),
    last_seen_txn_offset: LogOffset.last_before_real_offsets(),
    last_persisted_offset: LogOffset.last_before_real_offsets(),
    last_persisted_txn_offset: LogOffset.last_before_real_offsets(),
    write_position: 0,
    bytes_in_chunk: 0,
    times_flushed: 0,
    chunk_started?: false

  # Record that controls the writer's state including parts that shouldn't change in reduction
  defrecord :writer_state, [
    :writer_acc,
    :write_timer,
    :open_files,
    :ets,
    :opts
  ]

  # Struct that can be used to create a writer_state record or a reader
  @version 1
  defstruct [
    :buffer_ets,
    :base_path,
    :data_dir,
    :metadata_dir,
    :log_dir,
    :stack_id,
    :stack_ets,
    :shape_handle,
    :chunk_bytes_threshold,
    :flush_period,
    version: @version
  ]

  def shared_opts(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")

    # Always scope the provided storage dir by stack id
    %{
      base_path: Path.join(storage_dir, stack_id),
      stack_ets: :"#{__MODULE__}:#{stack_id}",
      stack_id: stack_id,
      chunk_bytes_threshold:
        Keyword.get(opts, :chunk_bytes_threshold, LogChunker.default_chunk_size_threshold()),
      flush_period: Keyword.get(opts, :flush_period, :timer.seconds(1))
    }
  end

  def for_shape(shape_handle, opts) do
    data_dir = Path.join([opts.base_path, shape_handle])

    buffer_ets =
      :ets.lookup_element(opts.stack_ets, shape_handle, storage_meta(:ets_table) + 1, nil)

    %__MODULE__{
      base_path: opts.base_path,
      data_dir: data_dir,
      log_dir: Path.join([data_dir, "log"]),
      metadata_dir: Path.join([data_dir, "metadata"]),
      shape_handle: shape_handle,
      stack_id: opts.stack_id,
      stack_ets: opts.stack_ets,
      chunk_bytes_threshold: opts.chunk_bytes_threshold,
      flush_period: opts.flush_period,
      buffer_ets: buffer_ets
    }
  end

  def stack_start_link(opts) do
    Agent.start_link(fn ->
      :ets.new(opts.stack_ets, [
        :named_table,
        :set,
        :public,
        keypos: storage_meta(:shape_handle) + 1,
        read_concurrency: true,
        write_concurrency: true
      ])
    end)
  end

  def get_all_stored_shapes(%{base_path: base_path} = opts) do
    case ls(base_path) do
      {:error, :enoent} ->
        {:ok, %{}}

      {:ok, shape_handles} ->
        shape_handles
        |> Enum.map(&for_shape(&1, opts))
        |> Enum.reject(&File.exists?(deletion_marker_path(&1), [:raw]))
        |> Enum.reduce(%{}, fn opts, acc ->
          case read_shape_definition(opts) do
            {:ok, shape} -> Map.put(acc, opts.shape_handle, shape)
            _ -> acc
          end
        end)
        |> then(&{:ok, &1})
    end
  end

  def cleanup!(%__MODULE__{} = opts) do
    # do a quick touch operation to exclude this directory from `get_all_stored_shapes`
    marker_file_path = deletion_marker_path(opts)

    try do
      File.touch!(marker_file_path)
      unsafe_cleanup_with_retries!(opts)
    after
      File.rm(marker_file_path)
    end
  end

  def compact(_shape_opts), do: raise("Not implemented")

  def compact(_shape_opts, _offset), do: raise("Not implemented")

  @doc false
  def deletion_marker_path(%__MODULE__{base_path: base_path, shape_handle: handle}) do
    Path.join([base_path, ".#{handle}-deleted"])
  end

  defp unsafe_cleanup_with_retries!(%__MODULE__{} = opts, attempts_left \\ 5) do
    with {:ok, _} <- rm_rf(opts.data_dir) do
      :ok
    else
      # There is a very unlikely but observed scenario where the rm_rf call
      # tries to delete a directory after having deleted all its files, but
      # due to some FS race the deletion fails with EEXIST. Very hard to test
      # and prevent so we mitigate it with arbitrary retries.
      {:error, :eexist, _} when attempts_left > 0 ->
        unsafe_cleanup_with_retries!(opts, attempts_left - 1)

      {:error, reason, path} ->
        raise File.Error,
          reason: reason,
          path: path,
          action: "remove files and directories recursively from"
    end
  end

  def get_total_disk_usage(%{base_path: base_path}),
    do: FileInfo.recursive_disk_usage(base_path)

  def set_pg_snapshot(pg_snapshot, %__MODULE__{} = opts),
    do: write_metadata!(opts, :pg_snapshot, pg_snapshot)

  def mark_snapshot_as_started(%__MODULE__{} = opts),
    do: write_metadata!(opts, :snapshot_started?, true)

  def snapshot_started?(%__MODULE__{} = opts),
    do: read_metadata!(opts, :snapshot_started?) || false

  def get_current_position(%__MODULE__{} = opts) do
    {:ok, get_latest_offset(opts), read_metadata!(opts, :pg_snapshot)}
  end

  defp get_latest_offset(%__MODULE__{} = opts) do
    try do
      # This element is there only after storage writer has started. Both stack ETS missing & entry missing will raise badarg
      :ets.lookup_element(
        opts.stack_ets,
        opts.shape_handle,
        storage_meta(:last_seen_txn_offset) + 1
      )
    rescue
      ArgumentError ->
        read_metadata!(opts, :last_persisted_txn_offset) || last_snapshot_chunk(opts) ||
          LogOffset.last_before_real_offsets()
    end
  end

  def start_link(_), do: :ignore

  def init_writer!(opts, shape_definition) do
    table = :ets.new(:in_memory_storage, [:ordered_set, :protected])

    initial_acc = initialise_filesystem!(opts, shape_definition)

    register_with_stack(opts, table, writer_acc(initial_acc, :last_persisted_txn_offset))

    writer_state(writer_acc: initial_acc, open_files: open_files(opts), opts: opts, ets: table)
  end

  def terminate(writer_state(opts: opts) = state) do
    writer_state(open_files: {f1, f2}) = flush_buffer(state)
    :file.sync(f1)
    :file.sync(f2)
    File.close(f1)
    File.close(f2)

    try do
      :ets.delete(opts.stack_ets, opts.shape_handle)
    rescue
      ArgumentError ->
        :ok
    end

    :ok
  end

  defp initialise_filesystem!(%__MODULE__{} = opts, shape_definition) do
    on_disk_version = read_metadata!(opts, :version)

    if on_disk_version != opts.version or not snapshot_complete?(opts) or
         is_nil(read_metadata!(opts, :pg_snapshot)),
       do: rm_rf!(opts.data_dir)

    create_directories!(opts)
    write_metadata!(opts, :version, @version)
    write_shape_definition!(opts, shape_definition)

    last_persisted_txn_offset =
      read_metadata!(opts, :last_persisted_txn_offset) || LogOffset.last_before_real_offsets()

    trim_log!(opts, last_persisted_txn_offset)

    json_file_size = FileInfo.get_file_size!(json_file(opts)) || 0
    chunk_file_size = FileInfo.get_file_size!(chunk_file(opts)) || 0
    {chunk_status, _, position} = ChunkIndex.get_last_boundary(chunk_file(opts), chunk_file_size)

    writer_acc(
      last_persisted_offset: last_persisted_txn_offset,
      last_persisted_txn_offset: last_persisted_txn_offset,
      last_seen_offset: last_persisted_txn_offset,
      last_seen_txn_offset: last_persisted_txn_offset,
      write_position: json_file_size,
      bytes_in_chunk: json_file_size - position,
      chunk_started?: chunk_status != :complete
    )
  end

  defp trim_log!(%__MODULE__{} = opts, last_persisted_offset) do
    # Persisted offset writes are guaranteed to be last & atomic, so we can use it as a marker for the end of the log

    # First, we need to make sure that chunk file is fine: it should be aligned, and last chunk shoudn't overshoot the
    # new end of log.
    search_start_pos = ChunkIndex.realign_and_trim(chunk_file(opts), last_persisted_offset)

    # Now, we'll search for the first line that's greater than the last persisted offset and truncate the log there
    LogFile.trim(json_file(opts), search_start_pos, last_persisted_offset)
  end

  defp read_metadata!(%__MODULE__{metadata_dir: metadata_dir}, key) do
    case File.open(
           Path.join(metadata_dir, "#{key}.bin"),
           [:read, :raw],
           &(&1 |> IO.binread(:eof) |> :erlang.binary_to_term())
         ) do
      {:ok, value} -> value
      {:error, :enoent} -> nil
    end
  end

  defp write_metadata!(%__MODULE__{metadata_dir: metadata_dir}, key, value) do
    File.write!(Path.join(metadata_dir, "#{key}.bin.tmp"), :erlang.term_to_binary(value), [
      :write,
      :raw
    ])

    rename!(
      Path.join(metadata_dir, "#{key}.bin.tmp"),
      Path.join(metadata_dir, "#{key}.bin")
    )
  end

  defp write_shape_definition!(%__MODULE__{metadata_dir: metadata_dir}, shape_definition) do
    File.write!(
      Path.join(metadata_dir, "shape_definition.json"),
      Jason.encode!(shape_definition),
      [:raw]
    )
  end

  defp read_shape_definition(%__MODULE__{metadata_dir: metadata_dir}) do
    path = Path.join(metadata_dir, "shape_definition.json")

    with {:ok, contents} <- File.open(path, [:read, :raw, :read_ahead], &IO.binread(&1, :eof)),
         {:ok, decoded} <- Jason.decode(contents),
         {:ok, rebuilt} <- Shape.from_json_safe(decoded) do
      {:ok, rebuilt}
    end
  end

  defp last_snapshot_chunk(%__MODULE__{} = opts), do: read_metadata!(opts, :last_snapshot_chunk)

  defp snapshot_complete?(%__MODULE__{} = opts) do
    not is_nil(read_metadata!(opts, :last_snapshot_chunk))
  end

  defp create_directories!(%__MODULE__{} = opts) do
    mkdir_p!(opts.data_dir)
    mkdir_p!(opts.log_dir)
    mkdir_p!(opts.metadata_dir)
  end

  defp register_with_stack(opts, table, stable_offset) do
    :ets.insert(
      opts.stack_ets,
      storage_meta(
        shape_handle: opts.shape_handle,
        ets_table: table,
        persisted_full_txn_offset: stable_offset,
        last_persisted_offset: stable_offset,
        last_seen_txn_offset: stable_offset
      )
    )
  end

  defp open_files(%__MODULE__{} = opts) do
    {
      File.open!(json_file(opts), [:append, :raw]),
      File.open!(chunk_file(opts), [:append, :raw])
    }
  end

  def get_chunk_end_log_offset(offset, %__MODULE__{}) when is_min_offset(offset),
    do: LogOffset.new(0, 0)

  def get_chunk_end_log_offset(offset, %__MODULE__{} = opts)
      when is_virtual_offset(offset) and not is_last_virtual_offset(offset) do
    case last_snapshot_chunk(opts) do
      # We don't have the "last one", so optimistically give the next chunk pointer.
      # If it turns out we're actually done, then this pointer will give beginning of txn log when requested with.
      nil -> LogOffset.increment(offset)
      # This is easy - we want to read next chunk and we know we can
      last when is_log_offset_lt(offset, last) -> LogOffset.increment(offset)
      # Requested chunk is at the end or beyond the end of the snapshot, serve from txn log. If no chunk is yet present, get end of log
      _ -> get_chunk_end_log_offset(LogOffset.last_before_real_offsets(), opts)
    end
  end

  def get_chunk_end_log_offset(offset, %__MODULE__{} = opts) do
    case ChunkIndex.fetch_chunk(chunk_file(opts), offset) do
      {:ok, max_offset, _} -> max_offset
      :error -> nil
    end
  end

  def make_new_snapshot!(stream, %__MODULE__{} = opts) do
    last_chunk_num = Snapshot.write_snapshot_stream!(stream, opts)
    write_metadata!(opts, :last_snapshot_chunk, LogOffset.new(0, last_chunk_num))

    :ets.update_element(
      opts.stack_ets,
      opts.shape_handle,
      {storage_meta(:last_seen_txn_offset) + 1, LogOffset.new(0, last_chunk_num)}
    )

    :ok
  end

  def get_log_stream(
        %LogOffset{op_offset: op_offset} = min_offset,
        %LogOffset{} = max_offset,
        %__MODULE__{} = opts
      )
      when not is_real_offset(min_offset) do
    if not snapshot_started?(opts), do: raise(Storage.Error, message: "Snapshot not started")

    case {last_snapshot_chunk(opts), min_offset} do
      {_, x} when is_min_offset(x) ->
        Snapshot.stream_chunk_lines(opts, 0)

      {%LogOffset{} = latest, min_offset} when is_log_offset_lt(min_offset, latest) ->
        # Stream next chunk of snapshot
        Snapshot.stream_chunk_lines(opts, op_offset + 1)

      {nil, _offset} ->
        # Try streaming the next chunk if the file already exists, otherwise wait for the file or end of snapshot to be announced
        # where either event should happen shortly, we just either hit a file switch or just before CubDB was updatred
        wait_for_chunk_file_or_snapshot_end(opts, op_offset + 1)

      {%LogOffset{}, offset} ->
        stream_main_log(offset, max_offset, opts)
    end
  end

  def get_log_stream(%LogOffset{} = min_offset, %LogOffset{} = max_offset, opts) do
    stream_main_log(min_offset, max_offset, opts)
  end

  defp stream_main_log(
         min_offset,
         max_offset,
         %__MODULE__{stack_ets: stack_ets, shape_handle: handle} = opts
       ) do
    {ets, last_persisted, last_seen} =
      case :ets.lookup(stack_ets, handle) do
        [] ->
          # Writer's not active, only disk reads are possible
          offset = get_latest_offset(opts)
          {nil, offset, offset}

        [
          storage_meta(
            ets_table: ets,
            last_persisted_offset: last_persisted,
            last_seen_txn_offset: last_seen
          )
        ] ->
          {ets, last_persisted, last_seen}
      end

    upper_read_bound = LogOffset.min(max_offset, last_seen)

    cond do
      is_log_offset_lte(last_persisted, min_offset) and is_nil(ets) ->
        []

      is_log_offset_lte(last_persisted, min_offset) ->
        read_range_from_ets_cache(ets, min_offset, upper_read_bound)

      is_log_offset_lte(upper_read_bound, last_persisted) ->
        stream_from_disk(opts, min_offset, upper_read_bound)

      true ->
        # Because ETS may be cleared by a flush in a parallel process, we're reading it out into memory.
        # It's expected to be fairly small in the worst case, up 64KB
        upper_range = read_range_from_ets_cache(ets, last_persisted, upper_read_bound)

        stream_from_disk(opts, min_offset, last_persisted)
        |> Stream.concat(upper_range)
    end
  end

  defp wait_for_chunk_file_or_snapshot_end(
         opts,
         chunk_number,
         max_wait_time \\ :timer.seconds(60),
         total_wait_time \\ 0
       )

  defp wait_for_chunk_file_or_snapshot_end(_, _, max, total) when total >= max,
    do: raise("Snapshot hasn't updated in #{max}ms")

  defp wait_for_chunk_file_or_snapshot_end(
         %__MODULE__{} = opts,
         chunk_number,
         max_wait_time,
         total_wait_time
       ) do
    cond do
      File.exists?(Snapshot.chunk_file_path(opts, chunk_number), [:raw]) ->
        Snapshot.stream_chunk_lines(opts, chunk_number)

      last_snapshot_chunk(opts) != nil ->
        []

      true ->
        Process.sleep(50)

        wait_for_chunk_file_or_snapshot_end(
          opts,
          chunk_number,
          max_wait_time,
          total_wait_time + 50
        )
    end
  end

  defp read_range_from_ets_cache(ets, %LogOffset{} = min, %LogOffset{} = max) do
    read_range_from_ets_cache(ets, LogOffset.to_tuple(min), LogOffset.to_tuple(max), [])
  end

  defp read_range_from_ets_cache(ets, min, {max_tx, max_op} = max, acc) do
    case :ets.next_lookup(ets, min) do
      :"$end_of_table" ->
        Enum.reverse(acc)

      {{min_tx, min_op}, _} when min_tx > max_tx or (min_tx == max_tx and min_op > max_op) ->
        Enum.reverse(acc)

      {new_min, [{_, item}]} ->
        read_range_from_ets_cache(ets, new_min, max, [item | acc])
    end
  end

  defp stream_from_disk(%__MODULE__{} = opts, min_offset, max_offset) do
    case ChunkIndex.fetch_chunk(chunk_file(opts), min_offset) do
      {:ok, chunk_end_offset, {start_pos, end_pos}} when not is_nil(end_pos) ->
        LogFile.stream_jsons(json_file(opts), start_pos, end_pos, min_offset)
        |> Stream.concat(stream_from_disk(opts, chunk_end_offset, max_offset))

      {:ok, nil, {start_pos, nil}} ->
        LogFile.stream_jsons_until_offset(json_file(opts), start_pos, min_offset, max_offset)

      :error ->
        []
    end
  end

  def append_to_log!(txn_lines, writer_state(writer_acc: acc) = state) do
    times_flushed = writer_acc(acc, :times_flushed)

    txn_lines
    |> normalize_log_stream()
    |> Enum.reduce(acc, fn
      {offset, _, _, _, _, _, _}, writer_acc(last_seen_txn_offset: min_offset) = acc
      when is_log_offset_lte(offset, min_offset) ->
        # Line already persisted, no-op
        acc

      {offset, _, _, _, _, _, _} = line, acc ->
        acc
        |> maybe_write_opening_chunk_boundary(state, offset)
        |> add_to_buffer(line)
        |> write_chunk_boundary(state)
        |> maybe_flush_buffer(state)
    end)
    |> case do
      writer_acc(buffer_size: 0, last_seen_offset: offset) = acc ->
        acc
        |> writer_acc(last_seen_txn_offset: offset)
        # Flushing the buffer again just to update metadata on last persisted transaction
        |> flush_buffer(state)
        |> then(&writer_state(state, writer_acc: &1))

      writer_acc(last_seen_offset: offset) = acc ->
        acc
        |> writer_acc(last_seen_txn_offset: offset)
        |> store_lines_in_ets(state)
        |> then(&writer_state(state, writer_acc: &1))
        |> schedule_flush(times_flushed)
    end
  end

  defp maybe_write_opening_chunk_boundary(writer_acc(chunk_started?: true) = acc, _, _), do: acc

  defp maybe_write_opening_chunk_boundary(
         writer_acc(write_position: pos) = acc,
         writer_state(open_files: {_, chunk_file}),
         offset
       ) do
    IO.binwrite(chunk_file, [LogOffset.to_int128(offset), <<pos::64>>])
    acc
  end

  # Contract for this behaviour is that for any messages with behaviour as the tag, the MFA will
  # be called with current writer state prepended, and the return value will be used as the new state
  defp schedule_flush(
         writer_state(writer_acc: writer_acc(times_flushed: new), write_timer: timer, opts: opts) =
           state,
         old
       )
       when new == old do
    if is_nil(timer) do
      ref =
        Process.send_after(
          self(),
          {Storage, {__MODULE__, :perform_scheduled_flush, [new]}},
          opts.flush_period
        )

      writer_state(state, write_timer: ref)
    else
      state
    end
  end

  defp schedule_flush(
         writer_state(writer_acc: writer_acc(times_flushed: new), write_timer: timer, opts: opts) =
           state,
         _
       ) do
    if not is_nil(timer), do: Process.cancel_timer(timer)

    ref =
      Process.send_after(
        self(),
        {Storage, {__MODULE__, :perform_scheduled_flush, [new]}},
        opts.flush_period
      )

    writer_state(state, write_timer: ref)
  end

  # This is a function call for the old flush, no reason to do anything
  def perform_scheduled_flush(
        writer_state(writer_acc: writer_acc(times_flushed: new)) = state,
        old
      )
      when new != old,
      do: state

  # No flushes happened between the last scheduled flush and now, so we can just do a normal flush
  def perform_scheduled_flush(writer_state(writer_acc: acc) = state, _) do
    writer_state(state, writer_acc: flush_buffer(acc, state))
  end

  defp store_lines_in_ets(
         writer_acc(ets_line_buffer: buffer) = acc,
         writer_state(ets: ets, opts: opts)
       ) do
    :ets.insert(ets, buffer)

    acc
    |> writer_acc(ets_line_buffer: [])
    |> update_global_persistence_information(opts)
  end

  @delayed_write 64 * 1024
  defp maybe_flush_buffer(writer_acc(buffer_size: size) = acc, _) when size < @delayed_write,
    do: acc

  defp maybe_flush_buffer(acc, state), do: flush_buffer(acc, state)

  defp write_chunk_boundary(
         writer_acc(bytes_in_chunk: total) = acc,
         writer_state(opts: %{chunk_bytes_threshold: maximum})
       )
       when total < maximum,
       do: writer_acc(acc, chunk_started?: true)

  defp write_chunk_boundary(
         writer_acc(last_seen_offset: offset, write_position: position) = acc,
         writer_state(open_files: {_, chunk_file}) = state
       ) do
    IO.binwrite(chunk_file, [LogOffset.to_int128(offset), <<position::64>>])

    acc |> writer_acc(chunk_started?: false, bytes_in_chunk: 0) |> flush_buffer(state)
  end

  defp add_to_buffer(
         writer_acc(
           buffer: buffer,
           buffer_size: buffer_size,
           write_position: write_position,
           ets_line_buffer: ets_line_buffer,
           bytes_in_chunk: bytes_in_chunk
         ) =
           acc,
         {offset, key_size, key, op_type, flag, json_size, json}
       ) do
    iodata = [
      LogOffset.to_int128(offset),
      <<key_size::32>>,
      key,
      <<op_type::8, flag::8, json_size::64>>,
      json
    ]

    iodata_size = 30 + key_size + json_size

    writer_acc(acc,
      buffer: [buffer | iodata],
      ets_line_buffer: [{LogOffset.to_tuple(offset), json} | ets_line_buffer],
      buffer_size: buffer_size + iodata_size,
      write_position: write_position + iodata_size,
      bytes_in_chunk: bytes_in_chunk + iodata_size,
      last_seen_offset: offset
    )
  end

  defp flush_buffer(writer_state(writer_acc: acc) = state) do
    writer_state(state, writer_acc: flush_buffer(acc, state))
  end

  defp flush_buffer(
         writer_acc(
           buffer: buffer,
           buffer_size: buffer_size,
           last_seen_offset: last_seen_offset,
           last_seen_txn_offset: last_seen_txn,
           last_persisted_txn_offset: last_persisted_txn,
           times_flushed: times_flushed
         ) = acc,
         writer_state(open_files: {json_file, _}, opts: storage, ets: ets) = _state
       ) do
    if buffer_size > 0 do
      IO.binwrite(json_file, buffer)
      :file.datasync(json_file)
    end

    if last_seen_txn != last_persisted_txn do
      write_metadata!(storage, :last_persisted_txn_offset, last_seen_txn)
    end

    # Because we've definitely persisted everything up to this point, we can remove all in-memory lines from ETS
    writer_acc(acc,
      buffer: [],
      buffer_size: 0,
      ets_line_buffer: [],
      last_persisted_offset: last_seen_offset,
      last_persisted_txn_offset: last_seen_txn,
      times_flushed: times_flushed + 1
    )
    |> update_global_persistence_information(storage)
    |> trim_ets(ets)
  end

  defp update_global_persistence_information(
         writer_acc(
           last_persisted_txn_offset: last_txn,
           last_persisted_offset: last_persisted,
           last_seen_txn_offset: last_seen_txn
         ) = acc,
         %__MODULE__{stack_ets: ets, shape_handle: handle}
       ) do
    :ets.update_element(ets, handle, [
      {storage_meta(:persisted_full_txn_offset) + 1, last_txn},
      {storage_meta(:last_persisted_offset) + 1, last_persisted},
      {storage_meta(:last_seen_txn_offset) + 1, last_seen_txn}
    ])

    acc
  rescue
    ArgumentError ->
      acc
  end

  defp trim_ets(acc, ets) do
    :ets.delete_all_objects(ets)
    acc
  end

  defp normalize_log_stream(stream) do
    Stream.map(stream, fn
      {log_offset, key, op_type, json} ->
        {log_offset, byte_size(key), key, get_op_type(op_type), 0, byte_size(json), json}

      {_, _, _, _, _, _, _} = formed_line ->
        formed_line
    end)
  end

  defp get_op_type(:insert), do: ?i
  defp get_op_type(:update), do: ?u
  defp get_op_type(:delete), do: ?d

  defp mkdir_p!(path) do
    case FileInfo.mkdir_p(path) do
      :ok -> :ok
      {:error, reason} -> raise Storage.Error, message: inspect(reason)
    end
  end

  defp rm_rf!(path) do
    File.rm_rf!(path)
  end

  defp rm_rf(path) do
    File.rm_rf(path)
  end

  defp ls(path) do
    FileInfo.ls(path)
  end

  defp rename!(path1, path2) do
    case FileInfo.rename(path1, path2) do
      :ok ->
        :ok

      {:error, reason} ->
        raise Storage.Error, message: inspect(reason) <> " while renaming #{path1} to #{path2}"
    end
  end

  @doc false
  def chunk_file(%__MODULE__{log_dir: log_dir}) do
    Path.join(log_dir, "log.0.chunk.bin")
  end

  @doc false
  def json_file(%__MODULE__{log_dir: log_dir}) do
    Path.join(log_dir, "log.0.jsonchunk")
  end
end
