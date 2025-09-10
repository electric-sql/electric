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
  alias Electric.ShapeCache.PureFileStorage.ActionFile
  alias Electric.ShapeCache.PureFileStorage.KeyIndex
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
  require Logger

  @behaviour Electric.ShapeCache.Storage

  # Record that's stored in the stack-wide ETS table for reader reference
  defrecord :storage_meta, [
    :shape_handle,
    :ets_table,
    :persisted_full_txn_offset,
    :last_persisted_offset,
    :last_seen_txn_offset,
    :compaction_boundary,
    :latest_name,
    :pg_snapshot,
    snapshot_started?: false,
    compaction_started?: false,
    last_snapshot_chunk: nil,
    cached_chunk_boundaries: {LogOffset.last_before_real_offsets(), []}
  ]

  # Record that controls the writer's progress & flush logic
  defrecord :writer_acc,
    buffer: [],
    ets_line_buffer: [],
    buffer_size: 0,
    key_buffer: [],
    key_buffer_size: 0,
    key_file_write_pos: 0,
    last_seen_offset: LogOffset.last_before_real_offsets(),
    last_seen_txn_offset: LogOffset.last_before_real_offsets(),
    last_persisted_offset: LogOffset.last_before_real_offsets(),
    last_persisted_txn_offset: LogOffset.last_before_real_offsets(),
    write_position: 0,
    bytes_in_chunk: 0,
    times_flushed: 0,
    chunk_started?: false,
    cached_chunk_boundaries: {LogOffset.last_before_real_offsets(), []}

  # Record that controls the writer's state including parts that shouldn't change in reduction
  defrecord :writer_state, [
    :writer_acc,
    :write_timer,
    :open_files,
    :ets,
    :latest_name,
    :opts
  ]

  # Struct that can be used to create a writer_state record or a reader
  @version 1
  defstruct [
    :buffer_ets,
    :base_path,
    :data_dir,
    :tmp_dir,
    :metadata_dir,
    :log_dir,
    :stack_id,
    :stack_ets,
    :stack_task_supervisor,
    :shape_handle,
    :chunk_bytes_threshold,
    :flush_period,
    :compaction_config,
    version: @version
  ]

  # Directory for storing metadata
  @metadata_storage_dir ".meta"

  def shared_opts(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")
    base_path = Path.join(storage_dir, stack_id)
    tmp_dir = Keyword.get(opts, :tmp_dir, Path.join(base_path, ".tmp"))

    # Always scope the provided storage dir by stack id
    %{
      base_path: Path.join(storage_dir, stack_id),
      tmp_dir: Path.join(tmp_dir, stack_id),
      stack_ets: :"#{__MODULE__}:#{stack_id}",
      stack_task_supervisor: ProcessRegistry.name(stack_id, __MODULE__.TaskSupervisor),
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

  def for_shape(shape_handle, opts) do
    data_dir = Path.join([opts.base_path, shape_handle])

    buffer_ets =
      :ets.lookup_element(opts.stack_ets, shape_handle, storage_meta(:ets_table) + 1, nil)

    %__MODULE__{
      base_path: opts.base_path,
      tmp_dir: opts.tmp_dir,
      data_dir: data_dir,
      log_dir: Path.join([data_dir, "log"]),
      metadata_dir: Path.join([data_dir, "metadata"]),
      shape_handle: shape_handle,
      stack_id: opts.stack_id,
      stack_ets: opts.stack_ets,
      stack_task_supervisor: opts.stack_task_supervisor,
      chunk_bytes_threshold: opts.chunk_bytes_threshold,
      flush_period: opts.flush_period,
      compaction_config: opts.compaction_config,
      buffer_ets: buffer_ets
    }
  end

  def stack_start_link(opts) do
    Supervisor.start_link(
      [
        {Agent,
         fn ->
           :ets.new(opts.stack_ets, [
             :named_table,
             :set,
             :public,
             keypos: storage_meta(:shape_handle) + 1,
             read_concurrency: true,
             write_concurrency: true
           ])
         end},
        {Task.Supervisor, name: opts.stack_task_supervisor}
      ],
      strategy: :one_for_one
    )
  end

  def get_all_stored_shape_handles(%{base_path: base_path} = opts) do
    case ls(base_path) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.reject(&String.starts_with?(&1, "."))
        |> Enum.reject(&File.exists?(deletion_marker_path(for_shape(&1, opts)), [:raw]))
        |> then(&{:ok, MapSet.new(&1)})

      {:error, :enoent} ->
        {:ok, MapSet.new()}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def get_all_stored_shapes(opts) do
    case get_all_stored_shape_handles(opts) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.map(&for_shape(&1, opts))
        |> Enum.reduce(%{}, fn opts, acc ->
          case read_shape_definition(opts) do
            {:ok, shape} -> Map.put(acc, opts.shape_handle, shape)
            _ -> acc
          end
        end)
        |> then(&{:ok, &1})

      {:error, reason} ->
        {:error, reason}
    end
  end

  def metadata_backup_dir(%{base_path: base_path}) do
    Path.join([base_path, @metadata_storage_dir, "backups"])
  end

  def cleanup!(%__MODULE__{} = opts) do
    # do a quick touch operation to exclude this directory from `get_all_stored_shapes`
    marker_file_path = deletion_marker_path(opts)

    try do
      case File.touch(marker_file_path) do
        :ok -> unsafe_cleanup_with_retries!(opts)
        # nothing to delete, no-op
        {:error, :enoent} -> :ok
        {:error, reason} -> raise File.Error, reason: reason, path: marker_file_path
      end
    after
      File.rm(marker_file_path)
    end
  end

  def schedule_compaction(opts) do
    half_period = div(opts.compaction_config.period, 2)

    # Schedule with jitter to avoid all compactions happening at the same time
    Process.send_after(
      self(),
      {Storage, {__MODULE__, :scheduled_compaction, []}},
      opts.compaction_config.period + Enum.random(-half_period..half_period)
    )
  end

  def scheduled_compaction(writer_state(opts: opts) = state) do
    schedule_compaction(opts)
    compact(opts, opts.compaction_config.keep_complete_chunks)

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
      {:complete, {_, end_offset}, {_, file_pos}, {_, key_pos}} ->
        prepare_compaction(%__MODULE__{} = opts, end_offset, file_pos, key_pos)

      :error ->
        # Not enough chunks to warrant compaction
        :ok
    end
  end

  defp prepare_compaction(%__MODULE__{} = opts, end_offset, file_pos, key_pos) do
    # Just-in-case file-existence-based lock
    if !read_cached_metadata(opts, :compaction_started?) do
      write_cached_metadata!(opts, :compaction_started?, true)

      Task.Supervisor.start_child(
        opts.stack_task_supervisor,
        __MODULE__,
        :make_compacted_files,
        [self(), opts, end_offset, file_pos, key_pos]
      )

      :ok
    else
      :already_in_progress
    end
  end

  def make_compacted_files(parent, %__MODULE__{} = opts, offset, log_file_pos, key_file_pos)
      when is_pid(parent) do
    mkdir_p!(opts.tmp_dir)

    current_suffix = latest_name(opts)
    {_, compacted_suffix} = compaction_boundary(opts)

    # We're copying parts of the file & keyfile to the tmp dir, because we expect tmp dir to be on a faster FS
    File.copy!(
      key_file(opts, current_suffix),
      tmp_file(opts, "latest_part.keyfile"),
      key_file_pos
    )

    if compacted_suffix do
      File.copy!(key_file(opts, compacted_suffix), tmp_file(opts, "compacted.keyfile"))
    else
      File.touch!(tmp_file(opts, "compacted.keyfile"))
    end

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
       {__MODULE__, :handle_compaction_finished,
        [offset, new_compacted_suffix, {log_file_pos, key_file_pos}]}}
    )
  end

  @doc false
  def handle_compaction_finished(
        writer_state(opts: opts, writer_acc: writer_acc) = state,
        offset,
        new_suffix,
        {log_file_pos, key_file_pos}
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

    KeyIndex.copy_adjusting_positions(
      key_file(opts, current_latest_suffix),
      key_file(opts, new_latest_suffix),
      key_file_pos,
      -log_file_pos
    )

    ChunkIndex.copy_adjusting_positions(
      chunk_file(opts, current_latest_suffix),
      chunk_file(opts, new_latest_suffix),
      offset,
      -log_file_pos,
      -key_file_pos
    )

    set_latest_name(opts, new_latest_suffix)
    write_cached_metadata!(opts, :compaction_started?, false)

    Task.Supervisor.start_child(opts.stack_task_supervisor, fn ->
      rm_rf!(json_file(opts, current_latest_suffix))
      rm_rf!(chunk_file(opts, current_latest_suffix))
      rm_rf!(key_file(opts, current_latest_suffix))
      rm_rf!(json_file(opts, old_suffix))
      rm_rf!(chunk_file(opts, old_suffix))
      rm_rf!(key_file(opts, old_suffix))
    end)

    writer_state(state,
      open_files: nil,
      latest_name: new_latest_suffix,
      writer_acc: adjust_write_positions(writer_acc, -log_file_pos, -key_file_pos)
    )
  end

  defp adjust_write_positions(
         writer_acc(write_position: write_position, key_file_write_pos: key_file_write_pos),
         log_file_pos,
         key_file_pos
       ) do
    writer_acc(
      write_position: write_position + log_file_pos,
      key_file_write_pos: key_file_write_pos + key_file_pos
    )
  end

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
    do: write_cached_metadata!(opts, :pg_snapshot, pg_snapshot)

  def mark_snapshot_as_started(%__MODULE__{} = opts),
    do: write_cached_metadata!(opts, :snapshot_started?, true)

  def snapshot_started?(%__MODULE__{} = opts),
    do: read_cached_metadata(opts, :snapshot_started?) || false

  def compaction_boundary(%__MODULE__{} = opts),
    do: read_metadata!(opts, :compaction_boundary) || {LogOffset.before_all(), nil}

  def set_compaction_boundary(%__MODULE__{} = opts, boundary) do
    :ets.update_element(
      opts.stack_ets,
      opts.shape_handle,
      {storage_meta(:compaction_boundary) + 1, boundary}
    )

    write_metadata!(opts, :compaction_boundary, boundary)
  end

  def latest_name(%__MODULE__{} = opts), do: read_metadata!(opts, :latest_name) || "latest.0"

  def set_latest_name(%__MODULE__{} = opts, name) do
    :ets.update_element(
      opts.stack_ets,
      opts.shape_handle,
      {storage_meta(:latest_name) + 1, name}
    )

    write_metadata!(opts, :latest_name, name)
    :ok
  end

  def get_current_position(%__MODULE__{} = opts) do
    {:ok, get_latest_offset(opts), read_cached_metadata(opts, :pg_snapshot)}
  end

  defp get_latest_offset(%__MODULE__{} = opts) do
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

  def init_writer!(opts, shape_definition, storage_recovery_state \\ nil) do
    table = :ets.new(:in_memory_storage, [:ordered_set, :protected])

    {initial_acc, suffix} =
      case maybe_use_cached_writer(opts, table, storage_recovery_state) do
        {:ok, {acc, latest_name}} ->
          {acc, latest_name}

        :cache_not_found ->
          {initial_acc, suffix} = initialise_filesystem!(opts, shape_definition)

          register_with_stack(
            opts,
            table,
            writer_acc(initial_acc, :last_persisted_txn_offset),
            compaction_boundary(opts),
            suffix,
            writer_acc(initial_acc, :cached_chunk_boundaries)
          )

          {initial_acc, suffix}
      end

    if shape_definition.storage.compaction == :enabled do
      schedule_compaction(opts)
    end

    writer_state(
      writer_acc: initial_acc,
      open_files: nil,
      latest_name: suffix,
      opts: opts,
      ets: table
    )
  end

  defp maybe_use_cached_writer(opts, table, {version, writer_acc() = acc, storage_meta() = meta})
       when version == opts.version do
    meta =
      meta
      |> storage_meta(ets_table: table)
      |> storage_meta(compaction_started?: false)

    :ets.insert(opts.stack_ets, meta)

    if not snapshot_complete?(opts) or is_nil(read_cached_metadata(opts, :pg_snapshot)) do
      :cache_not_found
    else
      {:ok, {acc, storage_meta(meta, :latest_name)}}
    end
  end

  defp maybe_use_cached_writer(_opts, _table, _), do: :cache_not_found

  def hibernate(writer_state() = state) do
    close_all_files(state)
  end

  def terminate(writer_state(opts: opts) = state) do
    writer_state(writer_acc: writer_acc) = close_all_files(state)

    try do
      case :ets.lookup(opts.stack_ets, opts.shape_handle) do
        [storage_meta] ->
          storage_meta =
            storage_meta
            |> storage_meta(ets_table: nil)
            |> storage_meta(compaction_started?: false)

          :ets.delete(opts.stack_ets, opts.shape_handle)
          {opts.version, writer_acc, storage_meta}

        [] ->
          nil
      end
    rescue
      ArgumentError -> nil
    end
  end

  defp close_all_files(writer_state(open_files: nil) = state) do
    state
  end

  defp close_all_files(writer_state() = state) do
    writer_state(open_files: {f1, f2, f3}) = state = flush_buffer(state)
    File.close(f1)
    File.close(f2)
    File.close(f3)

    writer_state(state, open_files: nil)
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

    suffix = latest_name(opts) || "latest.0"
    write_metadata!(opts, :latest_name, suffix)

    trim_log!(opts, last_persisted_txn_offset, suffix)

    json_file_size = FileInfo.get_file_size!(json_file(opts, suffix)) || 0

    key_file_size = FileInfo.get_file_size!(key_file(opts, suffix)) || 0

    chunks = ChunkIndex.read_last_n_chunks(chunk_file(opts, suffix), 4)

    {{_, chunk_end_offset}, {start_pos, end_pos}, _} =
      List.last(chunks, {{nil, :empty}, {0, nil}, nil})

    # If the last chunk is complete, we take the end as position to calculate chunk size
    position = end_pos || start_pos

    {writer_acc(
       last_persisted_offset: last_persisted_txn_offset,
       last_persisted_txn_offset: last_persisted_txn_offset,
       last_seen_offset: last_persisted_txn_offset,
       last_seen_txn_offset: last_persisted_txn_offset,
       write_position: json_file_size,
       key_file_write_pos: key_file_size,
       bytes_in_chunk: json_file_size - position,
       chunk_started?: is_nil(chunk_end_offset),
       cached_chunk_boundaries: reformat_chunks_for_cache(chunks)
     ), suffix}
  end

  defp trim_log!(%__MODULE__{} = opts, last_persisted_offset, suffix) do
    # Persisted offset writes are guaranteed to be last & atomic, so we can use it as a marker for the end of the log

    # First, we need to make sure that chunk file is fine: it should be aligned, and last chunk shoudn't overshoot the
    # new end of log.
    {log_search_start_pos, key_search_start_pos} =
      ChunkIndex.realign_and_trim(chunk_file(opts, suffix), last_persisted_offset)

    # Now, we'll search for the first line that's greater than the last persisted offset and truncate the log there
    LogFile.trim(json_file(opts, suffix), log_search_start_pos, last_persisted_offset)
    KeyIndex.trim(key_file(opts, suffix), json_file(opts, suffix), key_search_start_pos)
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

  # Read metadata with ETS-first, disk-fallback pattern
  defp read_cached_metadata(%__MODULE__{stack_ets: stack_ets, shape_handle: handle} = opts, key) do
    try do
      case :ets.lookup(stack_ets, handle) do
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
  defp read_multiple_cached_metadata(
         %__MODULE__{stack_ets: stack_ets, shape_handle: handle} = opts,
         keys
       ) do
    try do
      case :ets.lookup(stack_ets, handle) do
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

  defp write_metadata!(%__MODULE__{metadata_dir: metadata_dir}, key, value) do
    File.write!(Path.join(metadata_dir, "#{key}.bin.tmp"), :erlang.term_to_binary(value), [
      :write,
      :raw
    ])

    rename!(
      Path.join(metadata_dir, "#{key}.bin.tmp"),
      Path.join(metadata_dir, "#{key}.bin")
    )

    # {:ok, fd} = :prim_file.open(Path.join(metadata_dir, "#{key}.bin"), [:write, :raw])
    # :prim_file.write(fd, :erlang.term_to_binary(value))
    # :prim_file.close(fd)
  end

  # Write metadata to both disk and ETS
  defp write_cached_metadata!(
         %__MODULE__{stack_ets: stack_ets, shape_handle: handle} = opts,
         key,
         value
       ) do
    # Write to disk first
    write_metadata!(opts, key, value)

    # Update ETS if entry exists
    try do
      case key do
        :snapshot_started? ->
          :ets.update_element(stack_ets, handle, {storage_meta(:snapshot_started?) + 1, value})

        :compaction_started? ->
          :ets.update_element(stack_ets, handle, {storage_meta(:compaction_started?) + 1, value})

        :last_snapshot_chunk ->
          :ets.update_element(stack_ets, handle, {storage_meta(:last_snapshot_chunk) + 1, value})

        :pg_snapshot ->
          :ets.update_element(stack_ets, handle, {storage_meta(:pg_snapshot) + 1, value})
      end
    rescue
      ArgumentError ->
        # ETS entry doesn't exist yet, that's okay
        :ok
    end
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
    mkdir_p!(opts.data_dir)
    mkdir_p!(opts.log_dir)
    mkdir_p!(opts.metadata_dir)
  end

  defp register_with_stack(opts, table, stable_offset, compaction_boundary, suffix, chunks) do
    snapshot_started = read_metadata!(opts, :snapshot_started?) || false
    compaction_started = read_metadata!(opts, :compaction_started?) || false
    last_snapshot_chunk = read_metadata!(opts, :last_snapshot_chunk)
    pg_snapshot = read_metadata!(opts, :pg_snapshot)

    :ets.insert(
      opts.stack_ets,
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
      case :ets.lookup(opts.stack_ets, opts.shape_handle) do
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

  # We're opening the chunk file in sync mode because writes there are rare but we prefer for them
  # to be atomic
  defp open_files(%__MODULE__{} = opts, suffix) do
    {
      File.open!(json_file(opts, suffix), [:append, :raw]),
      File.open!(chunk_file(opts, suffix), [:append, :raw, :sync]),
      File.open!(key_file(opts, suffix), [:append, :raw])
    }
  end

  defp maybe_open_files(writer_state(open_files: x) = state) when not is_nil(x), do: state

  defp maybe_open_files(writer_state(opts: opts, latest_name: latest_name) = state) do
    {f1, f2, f3} = open_files(opts, latest_name)
    writer_state(state, open_files: {f1, f2, f3})
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
    :ok
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

    snapshot_started = Keyword.get(metadata, :snapshot_started?) || false
    last_snapshot_chunk = Keyword.get(metadata, :last_snapshot_chunk)

    if not snapshot_started, do: raise(Storage.Error, message: "Snapshot not started")

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

  defp stream_main_log(
         min_offset,
         max_offset,
         %__MODULE__{stack_ets: stack_ets, shape_handle: handle} = opts
       ) do
    {ets, last_persisted, last_seen, boundary_info} =
      case :ets.lookup(stack_ets, handle) do
        [] ->
          # Writer's not active, only disk reads are possible
          offset = get_latest_offset(opts)
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
        LogFile.stream_jsons(json_file(opts, suffix), start_pos, end_pos, min_offset)
        |> Stream.concat(stream_from_disk(opts, chunk_end_offset, max_offset, boundary_info))

      {:ok, nil, {start_pos, nil}} ->
        LogFile.stream_jsons_until_offset(
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
    times_flushed = writer_acc(acc, :times_flushed)
    state = maybe_open_files(state)

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
      # If the buffer has been fully flushed, no need to schedule more flushes
      writer_acc(buffer_size: 0, last_seen_offset: offset) = acc ->
        timer_ref = writer_state(state, :write_timer)
        if not is_nil(timer_ref), do: Process.cancel_timer(timer_ref)

        acc
        |> writer_acc(last_seen_txn_offset: offset)
        # Flushing the buffer again just to update metadata on last persisted transaction, and bring keyfile up to date
        |> flush_buffer(state, true)
        |> then(&writer_state(state, writer_acc: &1, write_timer: nil))

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
         writer_acc(write_position: pos, key_file_write_pos: key_pos) = acc,
         writer_state(open_files: {_, chunk_file, _}, opts: opts),
         offset
       ) do
    IO.binwrite(chunk_file, [LogOffset.to_int128(offset), <<pos::64, key_pos::64>>])

    writer_acc(acc, chunk_started?: true)
    |> add_opening_chunk_boundary_to_cache(offset, pos)
    |> update_chunk_boundaries_cache(opts)
  end

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
    :ets.update_element(
      opts.stack_ets,
      opts.shape_handle,
      {storage_meta(:cached_chunk_boundaries) + 1, cached}
    )

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
    writer_state(state, writer_acc: flush_buffer(acc, state, true), write_timer: nil)
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
  defp maybe_flush_buffer(writer_acc(key_buffer_size: size) = acc, state)
       when size >= @delayed_write,
       do: flush_buffer(acc, state, true)

  defp maybe_flush_buffer(writer_acc(buffer_size: size) = acc, state) when size >= @delayed_write,
    do: flush_buffer(acc, state, false)

  defp maybe_flush_buffer(acc, _), do: acc

  defp write_chunk_boundary(
         writer_acc(bytes_in_chunk: total) = acc,
         writer_state(opts: %{chunk_bytes_threshold: maximum})
       )
       when total < maximum,
       do: acc

  defp write_chunk_boundary(
         writer_acc(
           last_seen_offset: offset,
           write_position: position,
           key_file_write_pos: key_file_write_pos
         ) = acc,
         writer_state(open_files: {_, chunk_file, _}, opts: opts) = state
       ) do
    IO.binwrite(chunk_file, [
      LogOffset.to_int128(offset),
      <<position::64, key_file_write_pos::64>>
    ])

    acc
    |> writer_acc(chunk_started?: false, bytes_in_chunk: 0)
    |> add_closing_chunk_boundary_to_cache(offset, position)
    |> update_chunk_boundaries_cache(opts)
    |> flush_buffer(state, true)
  end

  defp add_to_buffer(
         writer_acc(
           buffer: buffer,
           key_buffer: key_buffer,
           key_buffer_size: key_buffer_size,
           key_file_write_pos: key_file_write_pos,
           buffer_size: buffer_size,
           write_position: write_position,
           ets_line_buffer: ets_line_buffer,
           bytes_in_chunk: bytes_in_chunk
         ) =
           acc,
         {offset, _, _, _, _, json_size, json} = line
       ) do
    {iodata, iodata_size} = LogFile.make_entry(line)
    {key_iodata, key_iodata_size} = KeyIndex.make_entry(line, write_position)

    writer_acc(acc,
      buffer: [buffer | iodata],
      ets_line_buffer: [{LogOffset.to_tuple(offset), json} | ets_line_buffer],
      key_buffer: [key_buffer | key_iodata],
      key_buffer_size: key_buffer_size + key_iodata_size,
      key_file_write_pos: key_file_write_pos + key_iodata_size,
      buffer_size: buffer_size + iodata_size,
      write_position: write_position + iodata_size,
      bytes_in_chunk: bytes_in_chunk + json_size,
      last_seen_offset: offset
    )
  end

  defp flush_buffer(writer_state(writer_acc: acc) = state) do
    writer_state(state, writer_acc: flush_buffer(acc, state, true))
  end

  defp flush_buffer(
         writer_acc(
           buffer: buffer,
           buffer_size: buffer_size,
           key_buffer: key_buffer,
           key_buffer_size: key_buffer_size,
           last_seen_offset: last_seen_offset,
           last_seen_txn_offset: last_seen_txn,
           last_persisted_txn_offset: last_persisted_txn,
           times_flushed: times_flushed
         ) = acc,
         writer_state(open_files: {json_file, _, key_file}, opts: storage, ets: ets) = _state,
         force_key_flush?
       ) do
    if buffer_size > 0 do
      IO.binwrite(json_file, buffer)
      :file.datasync(json_file)
    end

    # We're flushing keys on a different schedule from the main log because it fills up way slower
    # (because it doesn't store JSONs) but if we're flushing key index, we need to flush the main log too.
    # Essentially, write order is main log, then keys, then persistence pointer.
    {key_buffer, key_buffer_size} =
      if force_key_flush? and key_buffer_size > 0 do
        IO.binwrite(key_file, key_buffer)
        :file.datasync(key_file)
        {[], 0}
      else
        {key_buffer, key_buffer_size}
      end

    if last_seen_txn != last_persisted_txn do
      write_metadata!(storage, :last_persisted_txn_offset, last_seen_txn)
    end

    # Tell the parent process that we've flushed up to this point
    send(self(), {Storage, :flushed, last_seen_offset})

    # Because we've definitely persisted everything up to this point, we can remove all in-memory lines from ETS
    writer_acc(acc,
      buffer: [],
      buffer_size: 0,
      ets_line_buffer: [],
      key_buffer: key_buffer,
      key_buffer_size: key_buffer_size,
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
    true =
      :ets.update_element(
        ets,
        handle,
        [
          {storage_meta(:persisted_full_txn_offset) + 1, last_txn},
          {storage_meta(:last_persisted_offset) + 1, last_persisted},
          {storage_meta(:last_seen_txn_offset) + 1, last_seen_txn}
        ]
      )

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
  def chunk_file(%__MODULE__{log_dir: log_dir}, suffix) do
    Path.join(log_dir, "log.#{suffix}.chunk.bin")
  end

  @doc false
  def json_file(%__MODULE__{log_dir: log_dir}, suffix) do
    Path.join(log_dir, "log.#{suffix}.jsonfile.bin")
  end

  @doc false
  def key_file(%__MODULE__{log_dir: log_dir}, suffix) do
    Path.join(log_dir, "log.#{suffix}.keyfile.bin")
  end

  @doc false
  def tmp_file(%__MODULE__{tmp_dir: tmp_dir}, file_name) do
    Path.join(tmp_dir, file_name)
  end
end
