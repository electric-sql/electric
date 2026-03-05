defmodule Electric.ShapeCache.PureFileStorage do
  @moduledoc """
  Main architecture & feature overview:
  ---
  - 2 file formats: for snapshots and for main log, because snapshots have a requirement to be streamed as they're written
  - Snapshot format: comma-separated JSON lines (for future copy-to-socket possibilities), one file per chunk, ends with a `0x04` byte (end-of-transmission) to distinguish EOF because reader is up to date with writer from EOF because writer is finished
  - Main log format:
  - Log file: binary file, formatted as:

    ```elixir
    <<tx_offset::64, op_offset::64,
      key_size::32, key::binary(key_size),
      op_type::8, flag::8,
      json_size::64 json::binary(json_size)>>
    ```
  - Chunk file: binary file, formatted as:

    ```elixir
    <<min_tx_offset::64, min_op_offset::64, start_pos::64, key_start_pos::64,
      max_tx_offset::64, max_op_offset::64, end_pos::64, key_end_pos::64>>
    ```
    where start_pos & end_pos can be used for full chunk read into memory if needed, and min/max offsets are inclusive. Last chunk might not have the max/end part of the binary (i.e. it's half width)
  - Writes are buffered at 64kb or 1s boundary, and the main pointer is the "last persisted full txn offset" - it's updated atomically, and last, and the readers are expected to respect that pointer as an upper bound for reading - any entires in the log file beyond that are considered volatile and might be trimmed in case the writer hard-crashes without flushing. Any reads beyond that boundary should rely on system being live (see 2 next points).
  - For read consistency on live tail of the log, buffered writes are also made available to readers through an ETS. Anything not flushed to disk yet is addressable inside an ETS, and deleted from there as soon as flushed
  - Buffering is __not__ transaction-aligned. Flush might include multiple transactions, or be done mid-transaction. To allow for consistent reads, we maintain an in-memory pointer to "last written offset" (always gte than "last persisted full txn offset") which acts as a definitely-synced boundary for ongoing reads which read part of the transaction from ETS and disk when a transaction is partially written.
  - This 2-layer setup is there to allow for read-consistent buffered writes without reader processes going to the writer.
  - In case the writer is offline and in-memory ETS/buffer is not present, reads still succeed using on-disk information (i.e. last persisted full txn offset).
  """

  alias Electric.ProcessRegistry
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.PureFileStorage.ActionFile
  alias Electric.ShapeCache.PureFileStorage.ChunkIndex
  alias Electric.ShapeCache.PureFileStorage.FileInfo
  alias Electric.ShapeCache.PureFileStorage.KeyIndex
  alias Electric.ShapeCache.PureFileStorage.LogFile
  alias Electric.ShapeCache.PureFileStorage.Snapshot
  alias Electric.ShapeCache.PureFileStorage.WriteLoop
  alias Electric.ShapeCache.Storage

  import LogOffset
  import Electric.ShapeCache.PureFileStorage.SharedRecords

  import File, only: [write!: 3]

  require Logger

  @behaviour Electric.ShapeCache.Storage

  # Struct that can be used to create a writer_state record or a reader
  @version 1
  defstruct [
    :buffer_ets,
    :chunk_bytes_threshold,
    :shape_handle,
    :stack_id,
    :stack_ets,
    snapshot_file_timeout: :timer.seconds(5),
    version: @version
  ]

  # Explicitly specify which keys are actually stored as metadata files on disk
  # to avoid unnecessary FS operations for non-persistent keys
  @stored_keys [
    :version,
    :latest_name,
    :last_persisted_txn_offset,
    :snapshot_started?,
    :pg_snapshot,
    :last_snapshot_chunk,
    :compaction_started?,
    :compaction_boundary
  ]

  # Including `compaction_started?` would require bumping the version of the storage,
  # as there are cases where we would have a file with "false" stored in it.
  # For `snapshot_started?` we only have the metadata file if it has been set.
  @boolean_stored_keys [:snapshot_started?]

  # keys to populate an empty cache with and to preserve on writer termination
  # for access via the read path
  @read_path_keys [
    :cached_chunk_boundaries,
    :compaction_boundary,
    :last_persisted_offset,
    :last_persisted_txn_offset,
    :last_seen_txn_offset,
    :last_snapshot_chunk,
    :latest_name,
    :snapshot_started?
  ]

  @clean_cache_keys storage_meta_keys() -- @read_path_keys

  def shared_opts(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")
    # Always scope the provided storage dir by stack id
    base_path = Path.join(storage_dir, stack_id)

    # base the tmp dir at the root of the storage (.tmp/stack_id not
    # stack_id/.tmp) so it's easy to remove
    tmp_dir = Keyword.get(opts, :tmp_dir, Path.join([storage_dir, ".tmp", stack_id]))

    %{
      base_path: base_path,
      tmp_dir: tmp_dir,
      stack_id: stack_id,
      chunk_bytes_threshold:
        Keyword.get(opts, :chunk_bytes_threshold) || LogChunker.default_chunk_size_threshold(),
      flush_period: Keyword.get(opts, :flush_period) || :timer.seconds(1),
      compaction_config: %{
        period: Keyword.get(opts, :compaction_period) || :timer.minutes(10),
        keep_complete_chunks: Keyword.get(opts, :keep_complete_chunks) || 2
      }
    }
  end

  def for_shape(shape_handle, %{stack_id: stack_id} = stack_opts) do
    stack_ets = stack_ets(stack_id)
    buffer_ets = :ets.lookup_element(stack_ets, shape_handle, storage_meta(:ets_table) + 1, nil)

    %__MODULE__{
      buffer_ets: buffer_ets,
      chunk_bytes_threshold: stack_opts.chunk_bytes_threshold,
      shape_handle: shape_handle,
      stack_id: stack_id,
      stack_ets: :ets.whereis(stack_ets)
    }
  end

  @log_dir "log"
  @metadata_dir "metadata"
  @snapshot_dir "snapshot"

  @doc false
  def stack_ets(stack_id), do: :"Electric.ShapeCache.PureFileStorage:#{stack_id}"

  defp stack_task_supervisor(stack_id),
    do: ProcessRegistry.name(stack_id, __MODULE__.TaskSupervisor)

  def shape_data_dir(%__MODULE__{} = shape_opts) do
    shape_data_dir(shape_opts, [])
  end

  def shape_data_dir(%__MODULE__{stack_id: stack_id, shape_handle: shape_handle}, suffix) do
    base_path = Storage.opt_for_stack(stack_id, :base_path)
    shape_data_dir(base_path, shape_handle, suffix)
  end

  @doc false
  def shape_data_dir(base_path, shape_handle, suffix \\ [])
      when is_binary(base_path) and is_binary(shape_handle) do
    # nest storage to limit number of files per directory
    <<p1::binary-2, p2::binary-2, _::binary>> = shape_handle
    Path.join([base_path, p1, p2, shape_handle | suffix])
  end

  defp shape_log_dir(opts), do: shape_data_dir(opts, [@log_dir])
  def shape_log_path(opts, filename), do: shape_data_dir(opts, [@log_dir, filename])

  defp shape_metadata_dir(opts), do: shape_data_dir(opts, [@metadata_dir])
  defp shape_metadata_path(opts, filename), do: shape_data_dir(opts, [@metadata_dir, filename])

  defp shape_snapshot_dir(opts), do: shape_data_dir(opts, [@snapshot_dir])
  defp shape_snapshot_path(opts, filename), do: shape_data_dir(opts, [@snapshot_dir, filename])

  defp tmp_dir(%__MODULE__{} = opts), do: Storage.opt_for_stack(opts.stack_id, :tmp_dir)

  def stack_start_link(opts) do
    Supervisor.start_link(
      [
        {Agent,
         fn ->
           :ets.new(stack_ets(opts.stack_id), [
             :named_table,
             :set,
             :public,
             keypos: storage_meta(:shape_handle) + 1,
             read_concurrency: true,
             write_concurrency: :auto
           ])
         end},
        {Task.Supervisor, name: stack_task_supervisor(opts.stack_id)},
        # TODO: remove once we're sure that no install has un-nested storage
        # directories
        {Task, fn -> remove_unnested_storage(opts.base_path) end}
      ],
      strategy: :one_for_one
    )
  end

  def get_all_stored_shape_handles(%{base_path: base_path}) do
    {:ok,
     Path.wildcard("#{base_path}/*/*/*")
     |> Stream.map(&Path.basename/1)
     |> Enum.into(MapSet.new())}
  end

  def drop_all_ets_entries(stack_id) do
    try do
      :ets.delete_all_objects(stack_ets(stack_id))
      :ok
    rescue
      ArgumentError -> :ok
    end
  end

  def cleanup!(%__MODULE__{} = shape_opts) do
    stack_storage = Storage.for_stack(shape_opts.stack_id)
    Storage.cleanup!(stack_storage, shape_opts.shape_handle)
  end

  def cleanup!(stack_opts, shape_handle) do
    # This call renames the `shape_data_dir` out of the shape storage path. On
    # linux renames are atomic so there's no need for a marker to catch
    # half-deleted data
    with :ok <-
           Electric.AsyncDeleter.delete(
             stack_opts.stack_id,
             shape_data_dir(stack_opts.base_path, shape_handle)
           ) do
      :ets.delete(stack_ets(stack_opts.stack_id), shape_handle)
      :ok
    end
  end

  def cleanup_all!(%{stack_id: stack_id, base_path: base_path, tmp_dir: tmp_dir}) do
    with :ok <- Electric.AsyncDeleter.delete(stack_id, base_path),
         :ok <- Electric.AsyncDeleter.delete(stack_id, tmp_dir) do
      drop_all_ets_entries(stack_id)
    end
  end

  def schedule_compaction(compaction_config) do
    half_period = div(compaction_config.period, 2)

    # Schedule with jitter to avoid all compactions happening at the same time
    Process.send_after(
      self(),
      {Storage, {__MODULE__, :scheduled_compaction, [compaction_config]}},
      compaction_config.period + Enum.random(-half_period..half_period)
    )
  end

  def scheduled_compaction(writer_state(opts: shape_opts) = state, compaction_config) do
    schedule_compaction(compaction_config)
    compact(shape_opts, compaction_config.keep_complete_chunks)

    state
  end

  def compact(writer_state(opts: opts) = state, keep_complete_chunks) do
    compact(opts, keep_complete_chunks)
    state
  end

  def compact(%__MODULE__{} = opts, keep_complete_chunks)
      when is_integer(keep_complete_chunks) and keep_complete_chunks >= 0 do
    # Keep the last 2 chunks as-is so that anything that relies on the live stream and
    # transactional information/LSNs always has something to work with.
    case ChunkIndex.get_nth_chunk(
           chunk_file(opts, latest_name(opts)),
           -(keep_complete_chunks + 1),
           only_complete?: true
         ) do
      {:complete, {_, end_offset}, {_, file_pos}, _} ->
        prepare_compaction(%__MODULE__{} = opts, end_offset, file_pos)

      :error ->
        # Not enough chunks to warrant compaction
        :ok
    end
  end

  defp prepare_compaction(%__MODULE__{} = opts, end_offset, file_pos) do
    # Just-in-case file-existence-based lock
    if !read_cached_metadata(opts, :compaction_started?) do
      write_cached_metadata!(opts, :compaction_started?, true)

      Task.Supervisor.start_child(
        stack_task_supervisor(opts.stack_id),
        __MODULE__,
        :make_compacted_files,
        [self(), opts, end_offset, file_pos]
      )

      :ok
    else
      :already_in_progress
    end
  end

  def make_compacted_files(parent, %__MODULE__{} = opts, offset, log_file_pos)
      when is_pid(parent) do
    mkdir_p!(tmp_dir(opts))

    current_suffix = latest_name(opts)
    {_, compacted_suffix} = compaction_boundary(opts)

    # We're copying parts of the file & keyfile to the tmp dir, because we expect tmp dir to be on a faster FS
    if compacted_suffix do
      File.copy!(key_file(opts, compacted_suffix), tmp_file(opts, "compacted.keyfile"))
    else
      File.touch!(tmp_file(opts, "compacted.keyfile"))
    end

    KeyIndex.create_from_log(
      json_file(opts, current_suffix),
      tmp_file(opts, "latest_part.keyfile"),
      log_file_pos
    )

    KeyIndex.sort(
      [tmp_file(opts, "latest_part.keyfile"), tmp_file(opts, "compacted.keyfile")],
      tmp_file(opts, "merged.keyfile")
    )

    rm_rf!(tmp_file(opts, "latest_part.keyfile"))
    rm_rf!(tmp_file(opts, "compacted.keyfile"))

    action_file =
      ActionFile.create_from_key_index(
        tmp_file(opts, "merged.keyfile"),
        tmp_file(opts, "merged.actionfile")
      )

    files =
      if compacted_suffix,
        do: %{0 => json_file(opts, current_suffix), 1 => json_file(opts, compacted_suffix)},
        else: %{0 => json_file(opts, current_suffix)}

    {log_file, chunk_file, key_file} =
      LogFile.merge_with_actions(
        action_file,
        files,
        tmp_file(opts, "merged.logfile"),
        opts.chunk_bytes_threshold
      )

    new_compacted_suffix = "compacted.#{DateTime.utc_now() |> DateTime.to_unix(:millisecond)}"

    # Tmp dir is likely to be on the different FS, so we need to in-process copy instead of rename
    #    side-note, Erlang doesn't expose kernel-level copy :(
    #    see: https://github.com/erlang/otp/issues/7273
    File.cp!(log_file, json_file(opts, new_compacted_suffix))
    File.cp!(chunk_file, chunk_file(opts, new_compacted_suffix))
    File.cp!(key_file, key_file(opts, new_compacted_suffix))

    for path <- [
          log_file,
          chunk_file,
          key_file,
          tmp_file(opts, "merged.keyfile"),
          tmp_file(opts, "merged.actionfile")
        ],
        do: rm_rf!(path)

    send(
      parent,
      {Storage,
       {__MODULE__, :handle_compaction_finished, [offset, new_compacted_suffix, log_file_pos]}}
    )
  end

  @doc false
  def handle_compaction_finished(
        writer_state(opts: opts, writer_acc: writer_acc) = state,
        offset,
        new_suffix,
        log_file_pos
      ) do
    # This work is being done while the writer is stopped, so that the copy & trim doesn't miss anything,
    # but work here should be fast because writer is blocked.
    {old_suffix, _} = compaction_boundary(opts)
    current_latest_suffix = latest_name(opts)
    set_compaction_boundary(opts, {offset, new_suffix})

    state = close_all_files(state)

    new_latest_suffix = "latest.#{DateTime.utc_now() |> DateTime.to_unix(:millisecond)}"

    File.open!(json_file(opts, current_latest_suffix), [:read, :raw], fn f1 ->
      {:ok, ^log_file_pos} = :file.position(f1, log_file_pos)

      File.open!(json_file(opts, new_latest_suffix), [:write, :raw], fn f2 ->
        :file.copy(f1, f2)
      end)
    end)

    ChunkIndex.copy_adjusting_positions(
      chunk_file(opts, current_latest_suffix),
      chunk_file(opts, new_latest_suffix),
      offset,
      -log_file_pos,
      0
    )

    set_latest_name(opts, new_latest_suffix)
    write_cached_metadata!(opts, :compaction_started?, false)

    Task.Supervisor.start_child(stack_task_supervisor(opts.stack_id), fn ->
      rm_rf!(json_file(opts, current_latest_suffix))
      rm_rf!(chunk_file(opts, current_latest_suffix))
      rm_rf!(key_file(opts, current_latest_suffix))
      rm_rf!(json_file(opts, old_suffix))
      rm_rf!(chunk_file(opts, old_suffix))
      rm_rf!(key_file(opts, old_suffix))
    end)

    writer_state(state,
      latest_name: new_latest_suffix,
      writer_acc: WriteLoop.adjust_write_positions(writer_acc, -log_file_pos)
    )
  end

  def get_total_disk_usage(%{base_path: base_path}),
    do: FileInfo.recursive_disk_usage(base_path)

  def set_pg_snapshot(pg_snapshot, %__MODULE__{} = opts),
    do: write_cached_metadata!(opts, :pg_snapshot, pg_snapshot)

  def mark_snapshot_as_started(%__MODULE__{} = opts),
    do: write_cached_metadata!(opts, :snapshot_started?, true)

  def snapshot_started?(%__MODULE__{} = opts),
    do: read_cached_metadata(opts, :snapshot_started?) || false

  def compaction_boundary(%__MODULE__{} = opts),
    do: read_metadata!(opts, :compaction_boundary) || {LogOffset.before_all(), nil}

  def set_compaction_boundary(%__MODULE__{stack_ets: stack_ets} = opts, boundary) do
    :ets.update_element(
      stack_ets,
      opts.shape_handle,
      {storage_meta(:compaction_boundary) + 1, boundary}
    )

    write_metadata!(opts, :compaction_boundary, boundary)
  end

  def latest_name(%__MODULE__{} = opts),
    do: read_cached_metadata(opts, :latest_name) || "latest.0"

  def set_latest_name(%__MODULE__{stack_ets: stack_ets} = opts, name) do
    :ets.update_element(
      stack_ets,
      opts.shape_handle,
      {storage_meta(:latest_name) + 1, name}
    )

    write_metadata!(opts, :latest_name, name)
    :ok
  end

  def fetch_latest_offset(%__MODULE__{} = opts) do
    {:ok, read_latest_offset(opts)}
  end

  def fetch_pg_snapshot(%__MODULE__{} = opts) do
    {:ok, read_cached_metadata(opts, :pg_snapshot)}
  end

  defp read_latest_offset(%__MODULE__{} = opts) do
    read_multiple_cached_metadata(opts, [
      :last_seen_txn_offset,
      :last_persisted_txn_offset,
      :last_snapshot_chunk
    ])
    |> latest_offset()
  end

  defp latest_offset(metadata) do
    latest_offset =
      Keyword.get(metadata, :last_seen_txn_offset) ||
        Keyword.get(metadata, :last_persisted_txn_offset)

    if is_nil(latest_offset) or LogOffset.is_virtual_offset(latest_offset),
      do: Keyword.get(metadata, :last_snapshot_chunk) || LogOffset.last_before_real_offsets(),
      else: latest_offset
  end

  def start_link(_), do: :ignore

  def init_writer!(shape_opts, shape_definition) do
    table = :ets.new(:in_memory_storage, [:ordered_set, :protected])

    {initial_acc, suffix} = initialise_filesystem!(shape_opts)

    register_with_stack(
      shape_opts,
      table,
      WriteLoop.last_persisted_txn_offset(initial_acc),
      compaction_boundary(shape_opts),
      suffix,
      WriteLoop.cached_chunk_boundaries(initial_acc)
    )

    if shape_definition.storage.compaction == :enabled do
      shape_opts.stack_id
      |> Storage.opt_for_stack(:compaction_config)
      |> schedule_compaction()
    end

    writer_state(
      writer_acc: initial_acc,
      latest_name: suffix,
      opts: shape_opts,
      ets: table
    )
  end

  def hibernate(writer_state() = state) do
    close_all_files(state)
  end

  def terminate(writer_state(ets: ets_table, opts: opts) = state) do
    close_all_files(state)
    try(do: :ets.delete(ets_table), rescue: (_ -> true))
    clean_shape_ets_entry(opts)
  end

  # remove cached values not needed for the read path
  defp clean_shape_ets_entry(%__MODULE__{} = opts) do
    write_metadata_cache(
      opts,
      for(k <- @clean_cache_keys, do: {k, storage_meta_unset(k)})
    )
  end

  defp close_all_files(writer_state(writer_acc: acc) = state) do
    writer_state(state, writer_acc: WriteLoop.flush_and_close_all(acc, state))
  end

  def initialise_filesystem!(%__MODULE__{} = opts) do
    on_disk_version = read_metadata!(opts, :version)
    new? = is_nil(on_disk_version)

    initialize? =
      if not new? and
           (on_disk_version != opts.version or not snapshot_complete?(opts) or
              is_nil(read_metadata!(opts, :pg_snapshot))) do
        cleanup!(opts)
        true
      else
        new?
      end

    if initialize? do
      create_directories!(opts)
    end

    suffix =
      read_cached_metadata(opts, :latest_name) || write_metadata!(opts, :latest_name, "latest.0")

    {last_persisted_txn_offset, json_file_size, chunks} =
      if initialize? do
        {LogOffset.last_before_real_offsets(), 0, []}
      else
        last_persisted_txn_offset =
          read_cached_metadata(opts, :last_persisted_txn_offset) ||
            LogOffset.last_before_real_offsets()

        trim_log!(opts, last_persisted_txn_offset, suffix)

        {
          last_persisted_txn_offset,
          FileInfo.get_file_size!(json_file(opts, suffix)) || 0,
          ChunkIndex.read_last_n_chunks(chunk_file(opts, suffix), 4)
        }
      end

    {{_, chunk_end_offset}, {start_pos, end_pos}, _} =
      List.last(chunks, {{nil, :empty}, {0, nil}, nil})

    # If the last chunk is complete, we take the end as position to calculate chunk size
    position = end_pos || start_pos

    # finally write the version file which also acts as our
    # "is this a valid storage dir" test
    if initialize?, do: write_metadata!(opts, :version, @version)

    {WriteLoop.init_from_disk(
       last_persisted_txn_offset: last_persisted_txn_offset,
       write_position: json_file_size,
       bytes_in_chunk: json_file_size - position,
       chunk_started?: is_nil(chunk_end_offset),
       chunks: reformat_chunks_for_cache(chunks)
     ), suffix}
  end

  defp trim_log!(%__MODULE__{} = opts, last_persisted_offset, suffix) do
    # Persisted offset writes are guaranteed to be last & atomic, so we can use it as a marker for the end of the log

    # First, we need to make sure that chunk file is fine: it should be aligned, and last chunk shoudn't overshoot the
    # new end of log.
    {log_search_start_pos, _} =
      ChunkIndex.realign_and_trim(chunk_file(opts, suffix), last_persisted_offset)

    # Now, we'll search for the first line that's greater than the last persisted offset and truncate the log there
    LogFile.trim(json_file(opts, suffix), log_search_start_pos, last_persisted_offset)
  end

  # optimization for snapshot started boolean to avoid expensive file open
  defp read_metadata!(%__MODULE__{} = opts, key) when key in @boolean_stored_keys,
    do: FileInfo.exists?(shape_metadata_path(opts, "#{key}.bin"))

  defp read_metadata!(%__MODULE__{} = opts, key) when key in @stored_keys do
    case File.open(
           shape_metadata_path(opts, "#{key}.bin"),
           [:read, :raw],
           &(&1 |> IO.binread(:eof) |> :erlang.binary_to_term())
         ) do
      {:ok, value} -> value
      {:error, :enoent} -> nil
    end
  end

  defp read_metadata!(%__MODULE__{} = _opts, _key), do: nil

  # Read metadata with ETS-first, disk-fallback pattern
  defp read_cached_metadata(%__MODULE__{} = opts, key) do
    case read_multiple_cached_metadata(opts, [key]) do
      [{^key, nil}] -> read_metadata!(opts, key)
      [{^key, value}] -> value
    end
  end

  defp read_multiple_cached_metadata(%__MODULE__{} = opts, keys) do
    opts
    |> read_or_initialize_metadata(keys)
    |> expand_storage_meta(keys)
  end

  defp read_or_initialize_metadata(%__MODULE__{shape_handle: handle} = opts, keys) do
    case :ets.lookup(opts.stack_ets, handle) do
      [] -> populate_read_through_cache!(opts, keys)
      [storage_meta() = meta] -> meta
    end
  end

  defp populate_read_through_cache!(%__MODULE__{} = opts, extra_keys) do
    %{shape_handle: handle, stack_ets: stack_ets} = opts

    read_keys = Enum.into(extra_keys, MapSet.new(@read_path_keys))

    keys =
      for key <- read_keys do
        {key, read_metadata!(opts, key)}
      end

    meta = create_storage_meta([{:shape_handle, handle} | keys])

    # prevent race conditions where a writer initialises the ets
    # for a shape after we've checked for existence
    :ets.insert_new(stack_ets, meta)

    meta
  end

  defp write_metadata!(%__MODULE__{} = opts, key, value) when key in @boolean_stored_keys do
    path = Path.join(shape_metadata_dir(opts), "#{key}.bin")

    if value,
      do: write!(path, <<>>, [:write, :raw]),
      else: Electric.AsyncDeleter.delete(opts.stack_id, path)
  end

  defp write_metadata!(%__MODULE__{} = opts, key, value) when key in @stored_keys do
    metadata_dir = shape_metadata_dir(opts)

    path = Path.join(metadata_dir, to_string(key) <> ".bin")
    tmp_path = path <> ".tmp"
    write!(tmp_path, :erlang.term_to_binary(value), [:write, :raw])

    rename!(tmp_path, path)

    value
  end

  defp write_metadata!(%__MODULE__{} = _opts, _key, value) do
    value
  end

  # Write metadata to both disk and ETS
  defp write_cached_metadata!(%__MODULE__{} = opts, key, value) do
    # Write to disk first
    write_metadata!(opts, key, value)

    try do
      write_metadata_cache(opts, key, value)

      :ok
    rescue
      # ETS entry doesn't exist yet, that's okay
      ArgumentError -> :ok
    end
  end

  defp write_metadata_cache(%__MODULE__{} = opts, key, value) do
    write_metadata_cache(opts, [{key, value}])
  end

  defp write_metadata_cache(%__MODULE__{} = opts, key_values) when is_list(key_values) do
    %{stack_ets: stack_ets, shape_handle: handle} = opts

    updates = for {key, value} <- key_values, do: {storage_meta_key_pos(key), value}

    :ets.update_element(stack_ets, handle, updates)
  end

  defp last_snapshot_chunk(%__MODULE__{} = opts),
    do: read_cached_metadata(opts, :last_snapshot_chunk)

  defp snapshot_complete?(%__MODULE__{} = opts) do
    not is_nil(read_cached_metadata(opts, :last_snapshot_chunk))
  end

  defp create_directories!(%__MODULE__{} = opts) do
    mkdir_p!(shape_log_dir(opts))
    mkdir_p!(shape_metadata_dir(opts))
  end

  defp register_with_stack(opts, table, stable_offset, compaction_boundary, suffix, chunks) do
    metadata =
      read_multiple_cached_metadata(opts, [
        :snapshot_started?,
        :compaction_started?,
        :last_snapshot_chunk,
        :pg_snapshot
      ])

    snapshot_started = Keyword.get(metadata, :snapshot_started?) || false
    compaction_started = Keyword.get(metadata, :compaction_started?) || false
    last_snapshot_chunk = Keyword.get(metadata, :last_snapshot_chunk)
    pg_snapshot = Keyword.get(metadata, :pg_snapshot)

    # we can just insert here, ignoring any existing values because the writer
    # as full authority over the cached values in the ets
    :ets.insert(
      opts.stack_ets,
      storage_meta(
        shape_handle: opts.shape_handle,
        ets_table: table,
        last_persisted_txn_offset: stable_offset,
        last_persisted_offset: stable_offset,
        last_seen_txn_offset: stable_offset,
        compaction_boundary: compaction_boundary,
        latest_name: suffix,
        snapshot_started?: snapshot_started,
        pg_snapshot: pg_snapshot,
        compaction_started?: compaction_started,
        last_snapshot_chunk: last_snapshot_chunk,
        cached_chunk_boundaries: chunks
      )
    )
  end

  defp reformat_chunks_for_cache([]), do: {LogOffset.last_before_real_offsets(), []}

  defp reformat_chunks_for_cache([{{_, max}, _, _} | [_, _, _] = rest]),
    do: {max, Enum.map(rest, fn {offsets, pos, _key_pos} -> {offsets, pos} end)}

  defp reformat_chunks_for_cache(chunks),
    do:
      {LogOffset.last_before_real_offsets(),
       Enum.map(chunks, fn {offsets, pos, _key_pos} -> {offsets, pos} end)}

  @type chunk ::
          {{min :: LogOffset.t(), max :: LogOffset.t()},
           {log_start :: pos_integer(), log_end :: pos_integer()}}
  @spec read_boundary_info(%__MODULE__{}) :: {
          latest_path :: String.t(),
          compacted :: {boundary :: LogOffset.t(), path :: String.t()},
          cached_chunks :: {prev_max :: LogOffset.t() | nil, [chunk]}
        }
  defp read_boundary_info(%__MODULE__{} = opts) do
    metadata =
      read_multiple_cached_metadata(opts, [
        :latest_name,
        :compaction_boundary,
        :cached_chunk_boundaries
      ])

    normalize_boundary_info(
      opts,
      Keyword.get(metadata, :latest_name),
      Keyword.get(metadata, :compaction_boundary),
      Keyword.get(metadata, :cached_chunk_boundaries)
    )
  end

  defp normalize_boundary_info(opts, latest_name, compaction_boundary, cached_chunk_boundaries) do
    {
      latest_name || latest_name(opts),
      compaction_boundary || compaction_boundary(opts),
      cached_chunk_boundaries || {nil, []}
    }
  end

  def open_file(writer_state(opts: opts, latest_name: latest_name), type) do
    open_file(opts, latest_name, type)
  end

  defp open_file(opts, suffix, :json_file),
    do: File.open!(json_file(opts, suffix), [:append, :raw])

  # We're opening the chunk file in sync mode because writes there are rare but we prefer for them
  # to be atomic
  defp open_file(opts, suffix, :chunk_file),
    do: File.open!(chunk_file(opts, suffix), [:append, :raw, :sync])

  defp open_file(opts, suffix, :key_file), do: File.open!(key_file(opts, suffix), [:append, :raw])

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
    case fetch_chunk(offset, opts) do
      {:ok, max_offset, _} -> max_offset
      :error -> nil
    end
  end

  defp fetch_chunk(offset, %__MODULE__{} = opts, boundary_info \\ nil) do
    {latest_name, {compaction_boundary, compacted_name}, {cached_min, chunks}} =
      boundary_info || read_boundary_info(opts)

    # Any virtual offsets are handled elsewhere - normalize them to the last before real offsets for main log
    offset = if is_virtual_offset(offset), do: LogOffset.last_before_real_offsets(), else: offset

    cond do
      LogOffset.is_log_offset_lt(offset, compaction_boundary) ->
        ChunkIndex.fetch_chunk(chunk_file(opts, compacted_name), offset)

      not is_nil(cached_min) and LogOffset.is_log_offset_lte(cached_min, offset) ->
        find_chunk_positions_in_cache(chunks, offset)

      true ->
        ChunkIndex.fetch_chunk(chunk_file(opts, latest_name), offset)
    end
  end

  defp find_chunk_positions_in_cache([], _), do: :error
  defp find_chunk_positions_in_cache([{{_, nil}, positions}], _), do: {:ok, nil, positions}

  defp find_chunk_positions_in_cache([{{_, max}, positions} | _], offset)
       when is_log_offset_lt(offset, max),
       do: {:ok, max, positions}

  defp find_chunk_positions_in_cache([{{_, max}, _} | rest], offset)
       when is_log_offset_lte(max, offset),
       do: find_chunk_positions_in_cache(rest, offset)

  def make_new_snapshot!(stream, %__MODULE__{} = opts) do
    last_chunk_num = Snapshot.write_snapshot_stream!(stream, opts)
    write_cached_metadata!(opts, :last_snapshot_chunk, LogOffset.new(0, last_chunk_num))
  end

  def write_move_in_snapshot!(stream, name, %__MODULE__{} = opts) do
    path = shape_snapshot_path(opts, name)
    FileInfo.mkdir_p(shape_snapshot_dir(opts))

    stream
    |> Stream.map(fn [key, tags, json] ->
      tags_binary = Enum.map(tags, &[<<byte_size(&1)::16>>, &1])

      [
        <<byte_size(key)::32>>,
        <<byte_size(json)::64>>,
        <<?i::8>>,
        <<length(tags)::16>>,
        tags_binary,
        key,
        json
      ]
    end)
    |> Stream.into(File.stream!(path, [:delayed_write]))
    |> Stream.run()

    :ok
  end

  def append_move_in_snapshot_to_log!(name, writer_state(opts: opts, writer_acc: acc) = state) do
    starting_offset = WriteLoop.last_seen_offset(acc)

    writer_state(writer_acc: acc) =
      state =
      Stream.resource(
        fn ->
          {File.open!(shape_snapshot_path(opts, name), [:read, :raw, :read_ahead]),
           LogOffset.increment(starting_offset)}
        end,
        fn {file, offset} ->
          with {:meta, <<key_size::32, json_size::64, op_type::8, tag_count::16>>} <-
                 {:meta, IO.binread(file, 15)},
               _tags = read_tags(file, tag_count),
               <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
               <<json::binary-size(json_size)>> <- IO.binread(file, json_size) do
            {[{offset, key_size, key, op_type, 0, json_size, json}],
             {file, LogOffset.increment(offset)}}
          else
            {:meta, :eof} ->
              {:halt, {file, offset}}

            _ ->
              raise Storage.Error,
                message: "Incomplete move-in snapshot file at #{shape_snapshot_path(opts, name)}"
          end
        end,
        fn {file, _} ->
          File.close(file)
          FileInfo.delete(shape_snapshot_path(opts, name))
        end
      )
      |> append_to_log!(state)

    inserted_range = {starting_offset, WriteLoop.last_seen_offset(acc)}

    {inserted_range, state}
  end

  defp read_tags(file, tag_count) do
    for _ <- 1..tag_count//1 do
      <<tag_size::16>> = IO.binread(file, 2)
      <<tag::binary-size(tag_size)>> = IO.binread(file, tag_size)
      tag
    end
  end

  def append_move_in_snapshot_to_log_filtered!(
        name,
        writer_state(opts: opts, writer_acc: acc) = state,
        touch_tracker,
        snapshot,
        tags_to_skip
      ) do
    starting_offset = WriteLoop.last_seen_offset(acc)

    writer_state(writer_acc: acc) =
      state =
      Stream.resource(
        fn ->
          {File.open!(shape_snapshot_path(opts, name), [:read, :raw, :read_ahead]),
           LogOffset.increment(starting_offset)}
        end,
        fn {file, offset} ->
          with {:meta, <<key_size::32, json_size::64, op_type::8, tag_count::16>>} <-
                 {:meta, IO.binread(file, 15)},
               tags = read_tags(file, tag_count),
               <<key::binary-size(key_size)>> <- IO.binread(file, key_size),
               <<json::binary-size(json_size)>> <- IO.binread(file, json_size) do
            # Check if this row should be skipped
            if all_parents_moved_out?(tags, tags_to_skip) or
                 Electric.Shapes.Consumer.MoveIns.should_skip_query_row?(
                   touch_tracker,
                   snapshot,
                   key
                 ) do
              # Skip this row - don't increment offset
              {[], {file, offset}}
            else
              # Include this row
              {[{offset, key_size, key, op_type, 0, json_size, json}],
               {file, LogOffset.increment(offset)}}
            end
          else
            {:meta, :eof} ->
              {:halt, {file, offset}}

            _ ->
              raise Storage.Error,
                message: "Incomplete move-in snapshot file at #{shape_snapshot_path(opts, name)}"
          end
        end,
        fn {file, _} ->
          File.close(file)
          FileInfo.delete(shape_snapshot_path(opts, name))
        end
      )
      |> append_to_log!(state)

    inserted_range = {starting_offset, WriteLoop.last_seen_offset(acc)}

    {inserted_range, state}
  end

  defp all_parents_moved_out?(tags, tags_to_skip) do
    tags != [] and Enum.all?(tags, &MapSet.member?(tags_to_skip, &1))
  end

  def append_control_message!(control_message, writer_state(writer_acc: acc) = state)
      when is_binary(control_message) do
    offset = WriteLoop.last_seen_offset(acc)
    inserted_offset = LogOffset.increment(offset)

    state =
      [{inserted_offset, 0, "", ?c, 0, byte_size(control_message), control_message}]
      |> append_to_log!(state)

    inserted_range = {offset, inserted_offset}
    {inserted_range, state}
  end

  def get_log_stream(%LogOffset{} = min_offset, %LogOffset{} = max_offset, opts)
      when is_last_virtual_offset(min_offset) or is_real_offset(min_offset) do
    stream_main_log(min_offset, max_offset, opts)
  end

  def get_log_stream(
        %LogOffset{op_offset: op_offset} = min_offset,
        %LogOffset{} = max_offset,
        %__MODULE__{} = opts
      ) do
    # Single ETS lookup to get both snapshot_started? and last_snapshot_chunk
    metadata = read_multiple_cached_metadata(opts, [:snapshot_started?, :last_snapshot_chunk])

    snapshot_started? = Keyword.get(metadata, :snapshot_started?) || false
    last_snapshot_chunk = Keyword.get(metadata, :last_snapshot_chunk)

    if not snapshot_started? and not shape_gone?(opts) do
      raise(Storage.Error, message: "Snapshot not started")
    end

    case {last_snapshot_chunk, min_offset} do
      {_, x} when is_min_offset(x) ->
        Snapshot.stream_chunk_lines(opts, 0)

      {%LogOffset{} = latest, min_offset} when is_log_offset_lt(min_offset, latest) ->
        # Stream next chunk of snapshot
        Snapshot.stream_chunk_lines(opts, op_offset + 1)

      {nil, _offset} ->
        # Try streaming the next chunk if the file already exists, otherwise wait for the file or end of snapshot to be announced
        # where either event should happen shortly, we just either hit a file switch or just before the storage was updated
        wait_for_chunk_file_or_snapshot_end(opts, op_offset + 1)

      {%LogOffset{}, offset} ->
        stream_main_log(offset, max_offset, opts)
    end
  end

  defp stream_main_log(min_offset, max_offset, %__MODULE__{} = opts) do
    storage_meta(
      ets_table: ets,
      last_persisted_offset: last_persisted,
      last_persisted_txn_offset: last_persisted_txn,
      last_seen_txn_offset: last_seen,
      latest_name: latest_name,
      compaction_boundary: compaction,
      cached_chunk_boundaries: cached_boundaries
    ) = read_or_initialize_metadata(opts, [])

    last_persisted =
      last_persisted ||
        latest_offset(
          last_seen_txn_offset: last_seen,
          last_persisted_txn_offset: last_persisted_txn
        )

    last_seen = last_seen || last_persisted
    boundary_info = normalize_boundary_info(opts, latest_name, compaction, cached_boundaries)

    upper_read_bound = LogOffset.min(max_offset, last_seen)

    # Convert upper_read_bound to tuple for comparison with ETS offsets
    upper_read_bound_tuple = LogOffset.to_tuple(upper_read_bound)

    cond do
      is_log_offset_lte(last_persisted, min_offset) and is_nil(ets) ->
        []

      is_log_offset_lte(last_persisted, min_offset) ->
        # Pure ETS read case
        case read_range_from_ets_cache(ets, min_offset, upper_read_bound) do
          {_data, last_offset}
          when is_nil(last_offset) or last_offset < upper_read_bound_tuple ->
            # Empty or partial read - ETS was cleared by a concurrent flush.
            # Data is now on disk (flush writes to disk before clearing ETS),
            # so read directly from there using existing boundary info.
            stream_from_disk(opts, min_offset, upper_read_bound, boundary_info)

          {data, _last_offset} ->
            data
        end

      is_log_offset_lte(upper_read_bound, last_persisted) ->
        stream_from_disk(opts, min_offset, upper_read_bound, boundary_info)

      true ->
        # Mixed disk + ETS case
        # Because ETS may be cleared by a flush in a parallel process, we're reading it out into memory.
        # It's expected to be fairly small in the worst case, up 64KB
        case read_range_from_ets_cache(ets, last_persisted, upper_read_bound) do
          {_upper_range, last_offset}
          when is_nil(last_offset) or last_offset < upper_read_bound_tuple ->
            # Empty or partial read - ETS was cleared by a concurrent flush.
            # Data is now on disk, so read the full range from there.
            stream_from_disk(opts, min_offset, upper_read_bound, boundary_info)

          {upper_range, _last_offset} ->
            stream_from_disk(opts, min_offset, last_persisted, boundary_info)
            |> Stream.concat(upper_range)
        end
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
        if shape_gone?(opts) do
          []
        else
          Process.sleep(50)

          wait_for_chunk_file_or_snapshot_end(
            opts,
            chunk_number,
            max_wait_time,
            total_wait_time + 50
          )
        end
    end
  end

  # Returns {data, last_offset_read} where last_offset_read is the offset tuple of the
  # last entry read, or nil if no entries were read. This allows callers to detect
  # partial reads due to concurrent ETS clearing.
  @spec read_range_from_ets_cache(:ets.tid() | nil, LogOffset.t(), LogOffset.t()) ::
          {list(), LogOffset.t_tuple() | nil}
  defp read_range_from_ets_cache(nil, _min, _max), do: {[], nil}

  defp read_range_from_ets_cache(ets, %LogOffset{} = min, %LogOffset{} = max) do
    read_range_from_ets_cache(ets, LogOffset.to_tuple(min), LogOffset.to_tuple(max), [], nil)
  end

  @spec read_range_from_ets_cache(
          :ets.tid(),
          LogOffset.t_tuple(),
          LogOffset.t_tuple(),
          list(),
          LogOffset.t_tuple() | nil
        ) :: {list(), LogOffset.t_tuple() | nil}
  defp read_range_from_ets_cache(ets, min, {max_tx, max_op} = max, acc, last_offset) do
    case :ets.next_lookup(ets, min) do
      :"$end_of_table" ->
        {Enum.reverse(acc), last_offset}

      {{min_tx, min_op}, _} when min_tx > max_tx or (min_tx == max_tx and min_op > max_op) ->
        {Enum.reverse(acc), last_offset}

      {new_min, [{_, item}]} ->
        read_range_from_ets_cache(ets, new_min, max, [item | acc], new_min)
    end
  end

  defp stream_from_disk(%__MODULE__{}, min_offset, max_offset, _)
       when is_log_offset_lte(max_offset, min_offset),
       do: []

  defp stream_from_disk(
         %__MODULE__{} = opts,
         min_offset,
         max_offset,
         boundary_info
       ) do
    suffix = get_suffix(min_offset, boundary_info)

    case fetch_chunk(min_offset, opts, boundary_info) do
      {:ok, chunk_end_offset, {start_pos, end_pos}} when not is_nil(end_pos) ->
        LogFile.stream_jsons(
          opts,
          json_file(opts, suffix),
          start_pos,
          end_pos,
          min_offset
        )
        |> Stream.concat(stream_from_disk(opts, chunk_end_offset, max_offset, boundary_info))

      {:ok, nil, {start_pos, nil}} ->
        LogFile.stream_jsons_until_offset(
          opts,
          json_file(opts, suffix),
          start_pos,
          min_offset,
          max_offset
        )

      :error ->
        []
    end
  end

  defp get_suffix(min_offset, {_, {compaction_boundary, compacted_name}, _})
       when is_log_offset_lt(min_offset, compaction_boundary),
       do: compacted_name

  defp get_suffix(_, {latest_name, _, _}), do: latest_name

  def append_to_log!(txn_lines, state) do
    write_log_items(txn_lines, state, with: &WriteLoop.append_to_log!/3)
  end

  @doc """
  Append log items from a transaction fragment.

  Unlike `append_to_log!/2`, this does NOT advance `last_seen_txn_offset` or
  call `register_complete_txn`. Transaction completion should be signaled
  separately via `signal_txn_commit!/2`.

  This ensures that on crash/recovery, `fetch_latest_offset` returns the
  last committed transaction offset, not a mid-transaction offset.
  """
  def supports_txn_fragment_streaming?, do: true

  def append_fragment_to_log!(txn_fragment_lines, state) do
    write_log_items(txn_fragment_lines, state, with: &WriteLoop.append_fragment_to_log!/3)
  end

  defp write_log_items(log_items, writer_state(writer_acc: acc) = state, with: write_loop_fn) do
    log_items
    |> normalize_log_stream()
    |> write_loop_fn.(acc, state)
    |> case do
      {acc, cancel_flush_timer: true} ->
        timer_ref = writer_state(state, :write_timer)
        if not is_nil(timer_ref), do: Process.cancel_timer(timer_ref)
        writer_state(state, writer_acc: acc, write_timer: nil)

      {acc, schedule_flush: times_flushed} ->
        writer_state(state, writer_acc: acc)
        |> schedule_flush(times_flushed)
    end
  end

  @doc """
  Signal that a transaction has committed.

  Updates `last_seen_txn_offset` and persists metadata to mark the transaction
  as complete. Should be called after all fragments have been written via
  `append_fragment_to_log!/2`.
  """
  # xid is not actually used here since it's not possible for transaction writes to interleave.
  # It's part of the function signature for testing.
  def signal_txn_commit!(_xid, writer_state(writer_acc: acc) = state) do
    acc = WriteLoop.signal_txn_commit(acc, state)
    writer_state(state, writer_acc: acc)
  end

  def update_chunk_boundaries_cache(opts, boundaries) do
    :ets.update_element(
      opts.stack_ets,
      opts.shape_handle,
      {storage_meta(:cached_chunk_boundaries) + 1, boundaries}
    )
  end

  # Contract for this behaviour is that for any messages with behaviour as the tag, the MFA will
  # be called with current writer state prepended, and the return value will be used as the new state
  defp schedule_flush(writer_state(writer_acc: acc, write_timer: timer, opts: opts) = state, old) do
    if WriteLoop.has_flushed_since?(acc, old) or is_nil(timer) do
      if not is_nil(timer), do: Process.cancel_timer(timer)

      flush_period = Storage.opt_for_stack(opts.stack_id, :flush_period)

      ref =
        Process.send_after(
          self(),
          {Storage, {__MODULE__, :perform_scheduled_flush, [WriteLoop.times_flushed(acc)]}},
          flush_period
        )

      writer_state(state, write_timer: ref)
    else
      state
    end
  end

  def perform_scheduled_flush(writer_state(writer_acc: acc) = state, requested) do
    if not WriteLoop.has_flushed_since?(acc, requested) do
      # No flushes happened between the scheduling of the flush and now, so we can just do a normal flush
      writer_state(state, writer_acc: WriteLoop.flush_buffer(acc, state), write_timer: nil)
    else
      state
    end
  end

  def update_global_persistence_information(
        %__MODULE__{} = opts,
        last_persisted_txn_offset,
        last_persisted_offset,
        last_seen_txn_offset,
        old_last_persisted_txn_offset
      ) do
    if old_last_persisted_txn_offset != last_persisted_txn_offset do
      write_metadata!(opts, :last_persisted_txn_offset, last_persisted_txn_offset)
    end

    try do
      write_metadata_cache(
        opts,
        last_persisted_txn_offset: last_persisted_txn_offset,
        last_persisted_offset: last_persisted_offset,
        last_seen_txn_offset: last_seen_txn_offset
      )
    rescue
      ArgumentError -> true
    end
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

  defp rename!(path1, path2) do
    case FileInfo.rename(path1, path2) do
      :ok ->
        :ok

      {:error, reason} ->
        raise Storage.Error, message: inspect(reason) <> " while renaming #{path1} to #{path2}"
    end
  end

  @doc false
  def chunk_file(%__MODULE__{} = opts, suffix) do
    shape_log_path(opts, "log.#{suffix}.chunk.bin")
  end

  @doc false
  def json_file(%__MODULE__{} = opts, suffix) do
    shape_log_path(opts, "log.#{suffix}.jsonfile.bin")
  end

  @doc false
  def key_file(%__MODULE__{} = opts, suffix) do
    shape_log_path(opts, "log.#{suffix}.keyfile.bin")
  end

  @doc false
  def tmp_file(%__MODULE__{} = opts, filename), do: Path.join(tmp_dir(opts), filename)

  @type file_opener() :: (Path.t(), [File.mode()] ->
                            {:ok, File.file_descriptor()} | {:error, File.posix()})
  @doc false
  # Open a file for streaming. Returns `{:halt, :data_removed}` if the shape data has been
  # removed (i.e. the shape itself has been removed). Streaming functions should return
  # an empty stream rather than raise if this returns `{:halt, :data_removed}`.
  @spec safely_open_file!(%__MODULE__{}, Path.t(), [File.mode()], file_opener()) ::
          {:ok, File.file_descriptor()} | {:halt, :data_removed} | no_return()
  def safely_open_file!(%__MODULE__{} = opts, path, modes, open_fun \\ &File.open/2) do
    case open_fun.(path, modes) do
      {:ok, file} ->
        {:ok, file}

      {:error, _reason} = error ->
        handle_open_error!(opts, path, error)
    end
  end

  defp handle_open_error!(%__MODULE__{} = opts, path, {:error, :enoent}) do
    if shape_gone?(opts) do
      {:halt, :data_removed}
    else
      raise File.Error, path: path, reason: :enoent
    end
  end

  defp handle_open_error!(%__MODULE__{}, path, {:error, reason}) do
    raise File.Error, path: path, reason: reason
  end

  defp shape_gone?(%__MODULE__{} = opts) do
    !FileInfo.exists?(shape_data_dir(opts))
  end

  defp remove_unnested_storage(base_dir) do
    "#{base_dir}/*"
    |> Path.wildcard()
    |> Enum.filter(fn path ->
      name = Path.basename(path)
      Regex.match?(~r/\d{6,}-\d{8,}/, name)
    end)
    |> tap(fn dirs ->
      Logger.notice("Removing #{length(dirs)} old storage directories")
    end)
    |> Enum.each(fn path ->
      # remove with a delay - don't want this task to interfere with critical processes
      File.rm_rf(path)
      Process.sleep(20)
    end)
  end
end
