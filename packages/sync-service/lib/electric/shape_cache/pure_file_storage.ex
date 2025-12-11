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
  alias Electric.Shapes.Shape

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
    snapshot_file_timeout: :timer.seconds(5),
    version: @version
  ]

  # Directory for storing metadata
  @metadata_storage_dir ".meta"

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

  def for_shape(shape_handle, stack_opts) do
    stack_ets = stack_ets(stack_opts.stack_id)
    buffer_ets = :ets.lookup_element(stack_ets, shape_handle, storage_meta(:ets_table) + 1, nil)

    %__MODULE__{
      buffer_ets: buffer_ets,
      chunk_bytes_threshold: stack_opts.chunk_bytes_threshold,
      shape_handle: shape_handle,
      stack_id: stack_opts.stack_id
    }
  end

  @metadata_dir "metadata"
  @log_dir "log"
  @snapshot_dir "snapshot"
  @doc false
  def stack_ets(stack_id), do: :"#{inspect(__MODULE__)}:#{stack_id}"

  defp stack_task_supervisor(stack_id),
    do: ProcessRegistry.name(stack_id, __MODULE__.TaskSupervisor)

  defp shape_data_dir(%__MODULE__{} = shape_opts) do
    shape_data_dir(shape_opts, [])
  end

  defp shape_data_dir(%__MODULE__{stack_id: stack_id, shape_handle: shape_handle}, suffix) do
    {__MODULE__, stack_opts} = Storage.for_stack(stack_id)
    shape_data_dir(stack_opts.base_path, shape_handle, suffix)
  end

  defp shape_data_dir(base_path, shape_handle, suffix \\ [])
       when is_binary(base_path) and is_binary(shape_handle) do
    Path.join([base_path, shape_handle | suffix])
  end

  defp shape_log_dir(opts), do: shape_data_dir(opts, [@log_dir])
  def shape_log_path(opts, filename), do: shape_data_dir(opts, [@log_dir, filename])

  defp shape_metadata_dir(opts), do: shape_data_dir(opts, [@metadata_dir])
  defp shape_metadata_path(opts, filename), do: shape_data_dir(opts, [@metadata_dir, filename])

  defp shape_snapshot_dir(opts), do: shape_data_dir(opts, [@snapshot_dir])
  defp shape_snapshot_path(opts, filename), do: shape_data_dir(opts, [@snapshot_dir, filename])

  defp tmp_dir(%__MODULE__{} = opts) do
    {__MODULE__, stack_opts} = Storage.for_stack(opts.stack_id)
    stack_opts.tmp_dir
  end

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
        {Task.Supervisor, name: stack_task_supervisor(opts.stack_id)}
      ],
      strategy: :one_for_one
    )
  end

  def get_all_stored_shape_handles(%{base_path: base_path}) do
    case ls(base_path) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.reject(&String.starts_with?(&1, "."))
        |> then(&{:ok, MapSet.new(&1)})

      {:error, :enoent} ->
        {:ok, MapSet.new()}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def get_stored_shapes(stack_opts, shape_handles) do
    Task.Supervisor.async_stream(
      stack_task_supervisor(stack_opts.stack_id),
      shape_handles,
      fn handle ->
        shape_opts = for_shape(handle, stack_opts)

        case read_shape_definition(shape_opts) do
          {:ok, shape} ->
            {handle, {:ok, shape}}

          _ ->
            Logger.warning(
              "Failed to read shape definition for shape #{handle}, removing it from disk"
            )

            cleanup!(shape_opts)
            {handle, {:error, :failed_to_recover_shape}}
        end
      end,
      timeout: :infinity,
      ordered: false
    )
    |> Enum.map(fn {:ok, res} -> res end)
    |> Map.new()
  end

  def metadata_backup_dir(%{base_path: base_path}) do
    Path.join([base_path, @metadata_storage_dir, "backups"])
  end

  def delete_shape_ets_entry(stack_id, shape_handle) do
    try do
      :ets.delete(stack_ets(stack_id), shape_handle)
      :ok
    rescue
      ArgumentError -> :ok
    end
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
      delete_shape_ets_entry(stack_opts.stack_id, shape_handle)
    end
  end

  def cleanup_all!(%{stack_id: stack_id, base_path: base_path}) do
    with :ok <- Electric.AsyncDeleter.delete(stack_id, base_path) do
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

  def set_compaction_boundary(%__MODULE__{} = opts, boundary) do
    :ets.update_element(
      stack_ets(opts.stack_id),
      opts.shape_handle,
      {storage_meta(:compaction_boundary) + 1, boundary}
    )

    write_metadata!(opts, :compaction_boundary, boundary)
  end

  def latest_name(%__MODULE__{} = opts), do: read_metadata!(opts, :latest_name) || "latest.0"

  def set_latest_name(%__MODULE__{} = opts, name) do
    :ets.update_element(
      stack_ets(opts.stack_id),
      opts.shape_handle,
      {storage_meta(:latest_name) + 1, name}
    )

    write_metadata!(opts, :latest_name, name)
    :ok
  end

  def get_latest_offset(%__MODULE__{} = opts) do
    {:ok, read_latest_offset(opts)}
  end

  def get_pg_snapshot(%__MODULE__{} = opts) do
    {:ok, read_cached_metadata(opts, :pg_snapshot)}
  end

  defp read_latest_offset(%__MODULE__{} = opts) do
    metadata =
      read_multiple_cached_metadata(opts, [
        :last_seen_txn_offset,
        :last_snapshot_chunk
      ])

    case Keyword.get(metadata, :last_seen_txn_offset) do
      nil ->
        # ETS entry doesn't exist, fall back to disk reads
        read_metadata!(opts, :last_persisted_txn_offset) ||
          Keyword.get(metadata, :last_snapshot_chunk) ||
          LogOffset.last_before_real_offsets()

      found ->
        if LogOffset.is_virtual_offset(found),
          do: Keyword.get(metadata, :last_snapshot_chunk) || LogOffset.last_before_real_offsets(),
          else: found
    end
  end

  def start_link(_), do: :ignore

  def init_writer!(shape_opts, shape_definition) do
    table = :ets.new(:in_memory_storage, [:ordered_set, :protected])

    {initial_acc, suffix} = initialise_filesystem!(shape_opts, shape_definition)

    register_with_stack(
      shape_opts,
      table,
      WriteLoop.last_persisted_txn_offset(initial_acc),
      compaction_boundary(shape_opts),
      suffix,
      WriteLoop.cached_chunk_boundaries(initial_acc)
    )

    if shape_definition.storage.compaction == :enabled do
      {__MODULE__, stack_opts} = Storage.for_stack(shape_opts.stack_id)
      schedule_compaction(stack_opts.compaction_config)
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

  def terminate(writer_state(opts: opts) = state) do
    close_all_files(state)
    delete_shape_ets_entry(opts.stack_id, opts.shape_handle)
  end

  defp close_all_files(writer_state(writer_acc: acc) = state) do
    writer_state(state, writer_acc: WriteLoop.flush_and_close_all(acc, state))
  end

  defp initialise_filesystem!(%__MODULE__{} = opts, shape_definition) do
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
      write_shape_definition!(opts, shape_definition)
    end

    suffix = latest_name(opts) || write_metadata!(opts, :latest_name, "latest.0")

    {last_persisted_txn_offset, json_file_size, chunks} =
      if initialize? do
        {LogOffset.last_before_real_offsets(), 0, []}
      else
        last_persisted_txn_offset =
          read_metadata!(opts, :last_persisted_txn_offset) ||
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

  @cached_keys [
    :snapshot_started?,
    :pg_snapshot,
    :compaction_started?,
    :last_snapshot_chunk,
    :last_seen_txn_offset,
    :persisted_full_txn_offset,
    :last_persisted_offset,
    :compaction_boundary,
    :latest_name,
    :cached_chunk_boundaries
  ]

  # we need this because macro expects a compile-time atom
  for key <- @cached_keys do
    defp get_cached_by_key(meta, unquote(key)), do: storage_meta(meta, unquote(key))
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
  defp read_cached_metadata(%__MODULE__{shape_handle: handle} = opts, key) do
    try do
      case :ets.lookup(stack_ets(opts.stack_id), handle) do
        [] ->
          read_metadata!(opts, key)

        [storage_meta() = meta] ->
          get_cached_by_key(meta, key)
      end
    rescue
      ArgumentError ->
        read_metadata!(opts, key)
    end
  end

  # Read multiple metadata values with a single ETS lookup
  defp read_multiple_cached_metadata(%__MODULE__{shape_handle: handle} = opts, keys) do
    try do
      case :ets.lookup(stack_ets(opts.stack_id), handle) do
        [] ->
          # Fall back to reading from disk for each key
          Enum.map(keys, fn key -> {key, read_metadata!(opts, key)} end)

        [storage_meta() = meta] ->
          # Extract all requested values from the single ETS record
          Enum.map(keys, fn key -> {key, get_cached_by_key(meta, key)} end)
      end
    rescue
      ArgumentError ->
        # Fall back to reading from disk for each key
        Enum.map(keys, fn key -> {key, read_metadata!(opts, key)} end)
    end
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

  # Write metadata to both disk and ETS
  defp write_cached_metadata!(%__MODULE__{shape_handle: handle} = opts, key, value) do
    # Write to disk first
    write_metadata!(opts, key, value)

    # Update ETS if entry exists
    table = stack_ets(opts.stack_id)

    try do
      case key do
        :snapshot_started? ->
          :ets.update_element(table, handle, {storage_meta(:snapshot_started?) + 1, value})

        :compaction_started? ->
          :ets.update_element(table, handle, {storage_meta(:compaction_started?) + 1, value})

        :last_snapshot_chunk ->
          :ets.update_element(table, handle, {storage_meta(:last_snapshot_chunk) + 1, value})

        :pg_snapshot ->
          :ets.update_element(table, handle, {storage_meta(:pg_snapshot) + 1, value})
      end

      :ok
    rescue
      ArgumentError ->
        # ETS entry doesn't exist yet, that's okay
        :ok
    end
  end

  defp write_shape_definition!(%__MODULE__{} = opts, shape_definition) do
    write!(
      shape_metadata_path(opts, "shape_definition.json"),
      Jason.encode!(shape_definition),
      [:raw]
    )
  end

  defp read_shape_definition(%__MODULE__{} = opts) do
    path = shape_metadata_path(opts, "shape_definition.json")

    with {:ok, contents} <- File.open(path, [:read, :raw, :read_ahead], &IO.binread(&1, :eof)),
         {:ok, decoded} <- Jason.decode(if(is_binary(contents), do: contents, else: "")),
         {:ok, rebuilt} <- Shape.from_json_safe(decoded) do
      {:ok, rebuilt}
    end
  end

  defp last_snapshot_chunk(%__MODULE__{} = opts),
    do: read_cached_metadata(opts, :last_snapshot_chunk)

  defp snapshot_complete?(%__MODULE__{} = opts) do
    not is_nil(read_cached_metadata(opts, :last_snapshot_chunk))
  end

  defp create_directories!(%__MODULE__{} = opts) do
    mkdir_p!(shape_data_dir(opts))
    mkdir_p!(shape_log_dir(opts))
    mkdir_p!(shape_metadata_dir(opts))
  end

  defp register_with_stack(opts, table, stable_offset, compaction_boundary, suffix, chunks) do
    snapshot_started = read_metadata!(opts, :snapshot_started?) || false
    compaction_started = read_metadata!(opts, :compaction_started?) || false
    last_snapshot_chunk = read_metadata!(opts, :last_snapshot_chunk)
    pg_snapshot = read_metadata!(opts, :pg_snapshot)

    :ets.insert(
      stack_ets(opts.stack_id),
      storage_meta(
        shape_handle: opts.shape_handle,
        ets_table: table,
        persisted_full_txn_offset: stable_offset,
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
  @spec get_read_source_info(%__MODULE__{}) :: {
          latest_path :: String.t(),
          compacted :: {boundary :: LogOffset.t(), path :: String.t()},
          cached_chunks :: {prev_max :: LogOffset.t() | nil, [chunk]}
        }
  defp get_read_source_info(%__MODULE__{} = opts) do
    try do
      case :ets.lookup(stack_ets(opts.stack_id), opts.shape_handle) do
        [] ->
          {latest_name(opts), compaction_boundary(opts), {nil, []}}

        [
          storage_meta(
            compaction_boundary: boundary,
            latest_name: latest_name,
            cached_chunk_boundaries: cached_boundaries
          )
        ] ->
          {latest_name, boundary, cached_boundaries}
      end
    rescue
      ArgumentError ->
        {latest_name(opts), compaction_boundary(opts), {nil, []}}
    end
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
      boundary_info || get_read_source_info(opts)

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
    metadata =
      read_multiple_cached_metadata(opts, [:snapshot_started?, :last_snapshot_chunk])

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
        # where either event should happen shortly, we just either hit a file switch or just before CubDB was updatred
        wait_for_chunk_file_or_snapshot_end(opts, op_offset + 1)

      {%LogOffset{}, offset} ->
        stream_main_log(offset, max_offset, opts)
    end
  end

  defp stream_main_log(min_offset, max_offset, %__MODULE__{shape_handle: handle} = opts) do
    {ets, last_persisted, last_seen, boundary_info} =
      case :ets.lookup(stack_ets(opts.stack_id), handle) do
        [] ->
          # Writer's not active, only disk reads are possible
          {:ok, offset} = get_latest_offset(opts)
          {nil, offset, offset, get_read_source_info(opts)}

        [
          storage_meta(
            ets_table: ets,
            last_persisted_offset: last_persisted,
            last_seen_txn_offset: last_seen,
            latest_name: latest_name,
            compaction_boundary: compaction,
            cached_chunk_boundaries: cached_boundaries
          )
        ] ->
          {ets, last_persisted, last_seen, {latest_name, compaction, cached_boundaries}}
      end

    upper_read_bound = LogOffset.min(max_offset, last_seen)

    cond do
      is_log_offset_lte(last_persisted, min_offset) and is_nil(ets) ->
        []

      is_log_offset_lte(last_persisted, min_offset) ->
        read_range_from_ets_cache(ets, min_offset, upper_read_bound)

      is_log_offset_lte(upper_read_bound, last_persisted) ->
        stream_from_disk(opts, min_offset, upper_read_bound, boundary_info)

      true ->
        # Because ETS may be cleared by a flush in a parallel process, we're reading it out into memory.
        # It's expected to be fairly small in the worst case, up 64KB
        upper_range = read_range_from_ets_cache(ets, last_persisted, upper_read_bound)

        stream_from_disk(opts, min_offset, last_persisted, boundary_info)
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

  def append_to_log!(txn_lines, writer_state(writer_acc: acc) = state) do
    txn_lines
    |> normalize_log_stream()
    |> WriteLoop.append_to_log!(acc, state)
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

  def update_chunk_boundaries_cache(opts, boundaries) do
    :ets.update_element(
      stack_ets(opts.stack_id),
      opts.shape_handle,
      {storage_meta(:cached_chunk_boundaries) + 1, boundaries}
    )
  end

  # Contract for this behaviour is that for any messages with behaviour as the tag, the MFA will
  # be called with current writer state prepended, and the return value will be used as the new state
  defp schedule_flush(writer_state(writer_acc: acc, write_timer: timer, opts: opts) = state, old) do
    if WriteLoop.has_flushed_since?(acc, old) or is_nil(timer) do
      if not is_nil(timer), do: Process.cancel_timer(timer)

      {__MODULE__, stack_opts} = Storage.for_stack(opts.stack_id)

      ref =
        Process.send_after(
          self(),
          {Storage, {__MODULE__, :perform_scheduled_flush, [WriteLoop.times_flushed(acc)]}},
          stack_opts.flush_period
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
        %__MODULE__{shape_handle: handle} = opts,
        last_persisted_txn_offset,
        last_persisted_offset,
        last_seen_txn_offset,
        old_last_persisted_txn_offset
      ) do
    if old_last_persisted_txn_offset != last_persisted_txn_offset do
      write_metadata!(opts, :last_persisted_txn_offset, last_persisted_txn_offset)
    end

    try do
      true =
        :ets.update_element(
          stack_ets(opts.stack_id),
          handle,
          [
            {storage_meta(:persisted_full_txn_offset) + 1, last_persisted_txn_offset},
            {storage_meta(:last_persisted_offset) + 1, last_persisted_offset},
            {storage_meta(:last_seen_txn_offset) + 1, last_seen_txn_offset}
          ]
        )
    rescue
      ArgumentError ->
        true
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
    !File.exists?(shape_data_dir(opts))
  end
end
