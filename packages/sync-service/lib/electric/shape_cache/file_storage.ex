defmodule Electric.ShapeCache.FileStorage do
  use Retry

  alias Electric.ShapeCache.LogChunker
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias __MODULE__, as: FS

  require Logger

  import Electric.Replication.LogOffset, only: :macros

  # If the storage format changes, increase `@version` to prevent
  # the incompatable older versions being read
  @version 3
  @version_key :version

  @shape_definition_file_name "shape_defintion.json"
  @metadata_storage_dir ".meta"

  @xmin_key :snapshot_xmin
  @pg_snapshot_key :pg_snapshot
  @snapshot_meta_key :snapshot_meta
  @snapshot_started_key :snapshot_started
  @compaction_info_key :compaction_info
  @log_chunk_size_info :log_chunk_size

  @behaviour Electric.ShapeCache.Storage

  defstruct [
    :base_path,
    :shape_handle,
    :db,
    :data_dir,
    :cubdb_dir,
    :snapshot_dir,
    :log_dir,
    :stack_id,
    :extra_opts,
    :chunk_bytes_threshold,
    version: @version
  ]

  @impl Electric.ShapeCache.Storage
  def shared_opts(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")

    # Always scope the provided storage dir by stack id
    %{
      base_path: Path.join(storage_dir, stack_id),
      stack_id: stack_id,
      chunk_bytes_threshold:
        Keyword.get(opts, :chunk_bytes_threshold, LogChunker.default_chunk_size_threshold())
    }
  end

  @impl Electric.ShapeCache.Storage
  def for_shape(shape_handle, %FS{shape_handle: shape_handle} = opts) do
    opts
  end

  def for_shape(
        shape_handle,
        %{base_path: base_path, stack_id: stack_id} = opts
      ) do
    data_dir = Path.join([base_path, shape_handle])

    %FS{
      base_path: base_path,
      shape_handle: shape_handle,
      db: name(stack_id, shape_handle),
      data_dir: data_dir,
      cubdb_dir: Path.join([data_dir, "cubdb"]),
      snapshot_dir: Path.join([data_dir, "snapshots"]),
      log_dir: Path.join([data_dir, "log"]),
      stack_id: stack_id,
      extra_opts: Map.get(opts, :extra_opts, %{}),
      chunk_bytes_threshold: opts.chunk_bytes_threshold
    }
  end

  def name(stack_id, shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  @impl Electric.ShapeCache.Storage
  def stack_start_link(_), do: :ignore

  @impl Electric.ShapeCache.Storage
  def start_link(%FS{cubdb_dir: dir, db: db} = opts) do
    with :ok <- initialise_filesystem(opts) do
      CubDB.start_link(
        data_dir: dir,
        name: db,
        auto_file_sync: false,
        hibernate_after: Electric.Config.get_env(:shape_hibernate_after)
      )
    end
  end

  defp initialise_filesystem(opts) do
    with :ok <- File.mkdir_p(opts.data_dir),
         :ok <- File.mkdir_p(opts.cubdb_dir),
         :ok <- File.mkdir_p(opts.snapshot_dir),
         :ok <- File.mkdir_p(opts.log_dir) do
      :ok
    end
  end

  defp exists?(path) do
    File.exists?(path, [:raw])
  end

  @impl Electric.ShapeCache.Storage
  def init_writer!(%FS{} = opts, shape_definition, _storage_recovery_state \\ nil) do
    stored_version = stored_version(opts)
    db = validate_db_process!(opts.db)

    if stored_version != opts.version || is_nil(pg_snapshot(opts)) ||
         not exists?(shape_definition_path(opts)) ||
         not CubDB.has_key?(db, @snapshot_meta_key) do
      cleanup_internals!(opts)
    end

    if exists?(old_snapshot_path(opts)) do
      # This shape has had the snapshot written before we started using the new format.
      # We need to move the old snapshot into the new format and store correct metadata
      # so that we know it's complete.
      File.rename(old_snapshot_path(opts), snapshot_chunk_path(opts, 0))
      CubDB.put(db, @snapshot_meta_key, LogOffset.new(0, 0))
    end

    CubDB.put(db, @version_key, @version)
    set_shape_definition(shape_definition, opts)

    opts
  end

  defp old_snapshot_path(opts) do
    Path.join([opts.snapshot_dir, "snapshot.jsonl"])
  end

  defp set_shape_definition(shape, %FS{} = opts) do
    file_path = shape_definition_path(opts)
    encoded_shape = Jason.encode!(shape)

    case File.write(file_path, encoded_shape, [:exclusive]) do
      :ok ->
        :ok

      {:error, :eexist} ->
        # file already exists - by virtue of the shape handle being the hash of the
        # definition we do not need to compare them
        :ok

      {:error, reason} ->
        raise "Failed to write shape definition to file: #{reason}"
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shape_handles(opts) do
    shapes_dir = opts.base_path

    case File.ls(shapes_dir) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.reject(&String.starts_with?(&1, "."))
        |> Enum.reject(&exists?(deletion_marker_path(shapes_dir, &1)))
        |> then(&{:ok, MapSet.new(&1)})

      {:error, :enoent} ->
        # if not present, there's no stored shapes
        {:ok, MapSet.new()}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shapes(opts) do
    case get_all_stored_shape_handles(opts) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.reduce(%{}, fn shape_handle, acc ->
          shape_def_path =
            shape_definition_path(%{
              data_dir: Path.join([opts.base_path, shape_handle])
            })

          with {:ok, shape_def_encoded} <- File.read(shape_def_path),
               {:ok, shape_def_json} <- Jason.decode(shape_def_encoded),
               {:ok, shape} <- Electric.Shapes.Shape.from_json_safe(shape_def_json) do
            Map.put(acc, shape_handle, shape)
          else
            # if the shape definition file cannot be read/decoded, just ignore it
            {:error, _reason} -> acc
          end
        end)
        |> then(&{:ok, &1})

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl Electric.ShapeCache.Storage
  def metadata_backup_dir(%{base_path: base_path}) do
    Path.join([base_path, @metadata_storage_dir, "backups"])
  end

  @impl Electric.ShapeCache.Storage
  def get_total_disk_usage(%{base_path: shapes_dir} = opts) do
    case File.ls(shapes_dir) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.map(&for_shape(&1, opts))
        |> Enum.map(&maybe_get_size(&1.data_dir))
        |> Enum.sum()

      _ ->
        0
    end
  end

  defp maybe_get_size(path) do
    case File.stat(path) do
      {:ok, %File.Stat{type: :regular, size: size}} ->
        size

      {:ok, %File.Stat{type: :directory}} ->
        case File.ls(path) do
          {:ok, files} ->
            files |> Enum.map(&maybe_get_size(Path.join(path, &1))) |> Enum.sum()

          {:error, _} ->
            0
        end

      _ ->
        0
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_current_position(%FS{} = opts) do
    {:ok, latest_offset(opts), pg_snapshot(opts)}
  end

  defp latest_offset(opts) do
    with nil <- get_latest_txn_log_offset(opts),
         nil <- get_last_snapshot_offset(opts) do
      # We're returning this very fake offset here due to our system's limitation: for ongoing log, we read "latest offset"
      # from an ETS table in the shape cache, that's updated by the consumer as it consumes the log. I don't want to introduce
      # any responsibility to chat to the consumer into the storage, so this gives the logic in the plug a good reference point
      # to compare snapshot offsets to. They are always going to be smaller than this, so we will be able to go through the chunks.
      LogOffset.last_before_real_offsets()
    end
  end

  defp get_latest_txn_log_offset(opts) do
    opts.db
    |> validate_db_process!()
    |> CubDB.select(
      min_key: log_start(),
      max_key: log_end(),
      min_key_inclusive: true,
      reverse: true
    )
    |> Enum.take(1)
    |> case do
      [{key, _}] -> offset(key)
      _ -> nil
    end
  end

  defp pg_snapshot(opts) do
    db = validate_db_process!(opts.db)

    # Temporary fallback to @xmin_key until we do a breaking release that drops that key entirely.
    with nil <- CubDB.get(db, @pg_snapshot_key),
         xmin when not is_nil(xmin) <- CubDB.get(db, @xmin_key) do
      %{xmin: xmin, xmax: xmin + 1, xip_list: [xmin], filter_txns?: true}
    end
  end

  @impl Electric.ShapeCache.Storage
  def set_pg_snapshot(pg_snapshot, %FS{} = opts) do
    opts.db
    |> validate_db_process!()
    |> CubDB.put(@pg_snapshot_key, pg_snapshot)
  end

  @impl Electric.ShapeCache.Storage
  def snapshot_started?(%FS{} = opts) do
    try do
      opts.db
      |> validate_db_process!()
      |> CubDB.has_key?(@snapshot_started_key)
    rescue
      Storage.Error -> false
    end
  end

  defp validate_db_process!(name) do
    if pid = GenServer.whereis(name) do
      pid
    else
      raise Storage.Error, message: "CubDb process not running"
    end
  end

  @impl Electric.ShapeCache.Storage
  def mark_snapshot_as_started(%FS{} = opts) do
    opts.db
    |> validate_db_process!()
    |> CubDB.put(@snapshot_started_key, true)
  end

  defp offset({_, tuple_offset}), do: LogOffset.new(tuple_offset)

  @impl Electric.ShapeCache.Storage
  def make_new_snapshot!(data_stream, %FS{stack_id: stack_id} = opts) do
    OpenTelemetry.with_span(
      "storage.make_new_snapshot",
      [storage_impl: "mixed_disk", "shape.handle": opts.shape_handle],
      stack_id,
      fn ->
        last_chunk_num = write_stream_to_chunk_files(data_stream, opts)

        opts.db
        |> validate_db_process!()
        |> CubDB.put(@snapshot_meta_key, LogOffset.new(0, last_chunk_num))
      end
    )
  end

  # Write to a set of "chunk" files, with numbering starting from 0, and return the highest chunk number
  defp write_stream_to_chunk_files(data_stream, opts) do
    data_stream
    |> Stream.transform(
      fn -> {0, nil} end,
      fn line, {chunk_num, file} ->
        file = file || open_snapshot_chunk_to_write(opts, chunk_num)

        case line do
          :chunk_boundary ->
            # Use the 4 byte marker (ASCII "end of transmission") to indicate the end of the snapshot,
            # so that concurrent readers can detect that the snapshot has been completed. This is a way to
            # distinguish between "file quiet" and "file done".
            IO.binwrite(file, <<4::utf8>>)
            File.close(file)
            {[], {chunk_num + 1, nil}}

          line ->
            IO.binwrite(file, [line, ?\n])
            {[chunk_num], {chunk_num, file}}
        end
      end,
      fn {chunk_num, file} ->
        if is_nil(file) and chunk_num == 0 do
          # Special case if the source stream has ended before we started writing any chunks - we need to create the empty file for the first chunk.
          {[chunk_num], {chunk_num, open_snapshot_chunk_to_write(opts, chunk_num)}}
        else
          {[], {chunk_num, file}}
        end
      end,
      fn {_chunk_num, file} ->
        if file do
          IO.binwrite(file, <<4::utf8>>)
          File.close(file)
        end
      end
    )
    |> Enum.reduce(0, fn chunk_num, _ -> chunk_num end)
  end

  defp open_snapshot_chunk_to_write(opts, chunk_number) do
    Logger.debug("Opening snapshot chunk #{chunk_number} for writing",
      shape_handle: opts.shape_handle,
      stack_id: opts.stack_id
    )

    File.open!(snapshot_chunk_path(opts, chunk_number), [:write, :raw])
  end

  def snapshot_chunk_path(opts, chunk_number)
      when is_integer(chunk_number) and chunk_number >= 0 do
    Path.join([opts.snapshot_dir, "snapshot_chunk.#{chunk_number}.jsonl"])
  end

  @impl Electric.ShapeCache.Storage
  def append_to_log!(log_items, %FS{} = opts) do
    compaction_boundary = get_compaction_boundary(opts)
    db = validate_db_process!(opts.db)

    current_chunk_size = CubDB.get(db, @log_chunk_size_info, 0)

    retry with: linear_backoff(50, 2) |> expiry(5_000) do
      entries =
        log_items
        |> LogChunker.intersperse_boundaries(
          current_chunk_size,
          opts.chunk_bytes_threshold,
          &item_size/1,
          &boundary/1
        )
        |> Enum.flat_map(fn
          {:chunk_boundary, offset} ->
            [{chunk_checkpoint_key(offset), nil}]

          # We have definitely seen this, but it's not going to be in CubDB after compaction,
          # so instead of idempotent insert we just ignore.
          {offset, _, _, _} when is_log_offset_lt(offset, compaction_boundary) ->
            []

          {offset, key, op_type, json_log_item} ->
            [{log_key(offset), {key, op_type, json_log_item}}]
        end)

      new_chunk_size =
        receive do
          {:current_chunk_size, value} -> value
        after
          0 -> 0
        end

      CubDB.put_multi(db, [{@log_chunk_size_info, new_chunk_size} | entries])

      send(self(), {Storage, :flushed, elem(List.last(log_items), 0)})

      :ok
    else
      error -> raise(error)
    end

    opts
  end

  defp item_size({_, _, _, json}), do: byte_size(json)
  defp boundary({offset, _, _, _}), do: {:chunk_boundary, offset}

  @impl Electric.ShapeCache.Storage
  def get_log_stream(
        %LogOffset{tx_offset: tx_offset, op_offset: op_offset} = offset,
        max_offset,
        %FS{} = opts
      )
      when tx_offset <= 0 do
    unless snapshot_started?(opts), do: raise(Storage.Error, message: "Snapshot not started")

    db = validate_db_process!(opts.db)

    case {CubDB.get(db, @snapshot_meta_key), offset} do
      # Snapshot is complete
      {%LogOffset{}, offset} when is_min_offset(offset) ->
        # Stream first chunk of snapshot
        stream_snapshot_chunk!(opts, 0)

      {%LogOffset{} = latest, offset} when is_log_offset_lt(offset, latest) ->
        # Stream next chunk of snapshot
        stream_snapshot_chunk!(opts, op_offset + 1)

      {%LogOffset{}, offset} ->
        stream_log_chunk(offset, max_offset, opts)

      # Snapshot is incomplete
      {nil, offset} when is_min_offset(offset) ->
        stream_snapshot_chunk!(opts, 0)

      {nil, _offset} ->
        # Try streaming the next chunk if the file already exists, otherwise wait for the file or end of snapshot to be announced
        # where either event should happen shortly, we just either hit a file switch or just before CubDB was updatred
        wait_for_chunk_file_or_snapshot_end(opts, op_offset + 1)
    end
  end

  # Any offsets with tx offset > 0 are not part of the initial snapshot, no need for additional checks.
  def get_log_stream(%LogOffset{} = offset, max_offset, %FS{} = opts),
    do: stream_log_chunk(offset, max_offset, opts)

  @impl Electric.ShapeCache.Storage
  def compact(%FS{} = opts, keep_complete_chunks) do
    opts.db
    |> validate_db_process!()
    |> CubDB.select(
      min_key: chunk_checkpoint_start(),
      max_key: chunk_checkpoint_end(),
      reverse: true
    )
    |> Enum.take(keep_complete_chunks)
    |> case do
      x when length(x) == keep_complete_chunks ->
        {key, _} = List.last(x)
        do_compact(opts, offset(key))

      _ ->
        # Not enough chunks to warrant compaction
        :ok
    end
  end

  defp do_compact(%FS{} = opts, %LogOffset{} = upper_bound) do
    # We consider log before the stored upper bound live & uncompacted. This means that concurrent readers
    # will be able to read out everything they want while the compaction is happening and we're only
    # atomically updating the pointer to the live portion.

    db = validate_db_process!(opts.db)
    parent = self()

    case CubDB.fetch(db, @compaction_info_key) do
      {:ok, {_, ^upper_bound}} ->
        :ok

      {:ok, {old_log, _}} ->
        # compact further
        new_log_file_path =
          Path.join(
            opts.log_dir,
            "compact_log_#{DateTime.utc_now() |> DateTime.to_unix(:millisecond)}.electric"
          )

        Task.start(fn ->
          new_log =
            CubDB.select(db,
              min_key: log_start(),
              max_key: log_key(upper_bound),
              max_key_inclusive: true
            )
            |> Stream.map(fn {key, {op_key, op_type, json}} ->
              {offset(key), op_key, op_type, json}
            end)
            |> FS.LogFile.write_log_file(new_log_file_path <> ".new")

          merged_log =
            FS.Compaction.merge_and_compact(
              old_log,
              new_log,
              new_log_file_path,
              opts.chunk_bytes_threshold
            )

          FS.Compaction.rm_log(new_log)

          send(
            parent,
            {Storage, {__MODULE__, :mark_compaction_done, [merged_log, upper_bound, old_log]}}
          )
        end)

        :ok

      :error ->
        Task.start(fn ->
          log_file_path = Path.join(opts.log_dir, "compact_log.electric")

          log =
            CubDB.select(db,
              min_key: log_start(),
              max_key: log_key(upper_bound),
              max_key_inclusive: true
            )
            |> Stream.map(fn {key, {op_key, op_type, json}} ->
              {offset(key), op_key, op_type, json}
            end)
            |> FS.LogFile.write_log_file(log_file_path)
            |> FS.Compaction.compact_in_place(opts.chunk_bytes_threshold)

          send(parent, {Storage, {__MODULE__, :mark_compaction_done, [log, upper_bound, nil]}})
        end)

        :ok
    end
  end

  def mark_compaction_done(opts, log, upper_bound, old_log) do
    opts.db
    |> validate_db_process!()
    |> CubDB.put(@compaction_info_key, {log, upper_bound})

    delete_compacted_keys(opts, upper_bound)

    if old_log, do: FS.Compaction.rm_log(old_log)

    opts
  end

  defp delete_compacted_keys(%FS{} = opts, upper_bound) do
    db = validate_db_process!(opts.db)

    compacted_chunks =
      CubDB.select(db,
        min_key: chunk_checkpoint_start(),
        max_key: chunk_checkpoint_key(upper_bound),
        max_key_inclusive: true
      )
      |> Enum.map(fn {key, _} -> key end)

    compacted_logs =
      CubDB.select(db,
        min_key: log_start(),
        max_key: log_key(upper_bound)
      )
      |> Enum.map(fn {key, _} -> key end)

    CubDB.delete_multi(db, compacted_chunks ++ compacted_logs)
  end

  # This function raises if the chunk file doesn't exist.
  defp stream_snapshot_chunk!(%FS{} = opts, chunk_number) do
    Stream.resource(
      fn -> {open_snapshot_chunk(opts, chunk_number), nil, ""} end,
      fn {{path, file}, eof_seen, incomplete_line} ->
        case IO.binread(file, :line) do
          {:error, reason} ->
            raise Storage.Error, message: "failed to read #{inspect(path)}: #{inspect(reason)}"

          :eof ->
            cond do
              is_nil(eof_seen) ->
                # First time we see eof after any valid lines, we store a timestamp
                {[], {{path, file}, System.monotonic_time(:millisecond), incomplete_line}}

              # If it's been 90s without any new lines, and also we've not seen <<4>>,
              # then likely something is wrong
              System.monotonic_time(:millisecond) - eof_seen > 90_000 ->
                raise Storage.Error, message: "Snapshot hasn't updated in 90s"

              true ->
                # Sleep a little and check for new lines
                Process.sleep(20)
                {[], {{path, file}, eof_seen, incomplete_line}}
            end

          # The 4 byte marker (ASCII "end of transmission") indicates the end of the snapshot file.
          <<4::utf8>> ->
            {:halt, {{path, file}, nil, ""}}

          line ->
            if binary_slice(line, -1, 1) == "\n" do
              {[incomplete_line <> line], {{path, file}, nil, ""}}
            else
              {[], {{path, file}, nil, incomplete_line <> line}}
            end
        end
      end,
      &File.close(elem(elem(&1, 0), 1))
    )
  end

  # Attempts enough for a 5s wait
  defp open_snapshot_chunk(opts, chunk_num, attempts_left \\ 250)

  defp open_snapshot_chunk(_, chunk_num, 0),
    do: raise(Storage.Error, message: "failed to read snapshot chunk #{chunk_num}: :enoent")

  defp open_snapshot_chunk(opts, chunk_num, attempts_left) do
    unless snapshot_started?(opts),
      do: raise(Storage.Error, message: "Snapshot not started")

    path = snapshot_chunk_path(opts, chunk_num)

    case File.open(path, [:read, :raw, read_ahead: 1024]) do
      {:ok, file} ->
        {path, file}

      {:error, :enoent} ->
        Process.sleep(20)
        open_snapshot_chunk(opts, chunk_num, attempts_left - 1)

      {:error, reason} ->
        raise IO.StreamError, reason: reason
    end
  end

  defp stream_log_chunk(%LogOffset{} = offset, max_offset, %FS{} = opts) do
    db = validate_db_process!(opts.db)

    case CubDB.fetch(db, @compaction_info_key) do
      {:ok, {log, upper_bound}} when is_log_offset_lt(offset, upper_bound) ->
        FS.ChunkIndex.fetch_chunk(elem(log, 1), offset)
        FS.LogFile.read_chunk(log, offset)

      _ ->
        db
        |> CubDB.select(
          min_key: log_key(offset),
          max_key: log_key(max_offset),
          min_key_inclusive: false
        )
        |> Stream.map(fn {_, {_, _, json_log_item}} -> json_log_item end)
    end
  end

  defp get_compaction_boundary(%FS{} = opts) do
    opts.db
    |> validate_db_process!()
    |> CubDB.fetch(@compaction_info_key)
    |> case do
      {:ok, {_, upper_bound}} -> upper_bound
      :error -> LogOffset.first()
    end
  end

  defp wait_for_chunk_file_or_snapshot_end(
         opts,
         chunk_number,
         max_wait_time \\ 60_000,
         total_wait_time \\ 0
       )

  defp wait_for_chunk_file_or_snapshot_end(_, _, max, total) when total >= max,
    do: raise("Snapshot hasn't updated in #{max}ms")

  defp wait_for_chunk_file_or_snapshot_end(
         %FS{} = opts,
         chunk_number,
         max_wait_time,
         total_wait_time
       ) do
    path = snapshot_chunk_path(opts, chunk_number)

    cond do
      exists?(path) ->
        stream_snapshot_chunk!(opts, chunk_number)

      CubDB.has_key?(validate_db_process!(opts.db), @snapshot_meta_key) ->
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

  @impl Electric.ShapeCache.Storage
  # If min offset was requested, then next chunk boundary is first snapshot chunk
  def get_chunk_end_log_offset(offset, _) when is_min_offset(offset),
    do: snapshot_offset(0)

  # If the current offset is one of the "real" chunks, then next chunk is the boundary
  def get_chunk_end_log_offset(offset, %FS{} = opts) when is_virtual_offset(offset) do
    case get_last_snapshot_offset(%FS{} = opts) do
      # We don't have the "last one", so optimistically give the next chunk pointer.
      # If it turns out we're actually done, then this pointer will give beginning of txn log when requested with.
      nil -> LogOffset.increment(offset)
      # This is easy - we want to read next chunk and we know we can
      last when is_log_offset_lt(offset, last) -> LogOffset.increment(offset)
      # Requested chunk is at the end or beyond the end of the snapshot, serve from txn log. If no chunk is yet present, get end of log
      _ -> get_chunk_end_for_log(offset, opts)
    end
  end

  # Current offset is in txn log, serve from there.
  def get_chunk_end_log_offset(offset, %FS{} = opts), do: get_chunk_end_for_log(offset, opts)

  defp get_chunk_end_for_log(offset, %FS{} = opts) do
    db = validate_db_process!(opts.db)

    case CubDB.fetch(db, @compaction_info_key) do
      {:ok, {log, upper_bound}} when is_log_offset_lt(offset, upper_bound) ->
        {:ok, max_offset, _} = FS.ChunkIndex.fetch_chunk(elem(log, 1), offset)
        max_offset

      _ ->
        CubDB.select(db,
          min_key: chunk_checkpoint_key(offset),
          max_key: chunk_checkpoint_end(),
          min_key_inclusive: false
        )
        |> Stream.map(fn {key, _} -> offset(key) end)
        |> Enum.take(1)
        |> Enum.at(0)
    end
  end

  defp get_last_snapshot_offset(%FS{} = opts) do
    opts.db
    |> validate_db_process!()
    |> CubDB.get(@snapshot_meta_key)
  end

  defp cleanup_internals!(%FS{} = opts) do
    db = validate_db_process!(opts.db)

    [
      @xmin_key,
      @pg_snapshot_key,
      @snapshot_meta_key,
      @snapshot_started_key
    ]
    |> Enum.concat(keys_from_range(log_start(), log_end(), opts))
    |> Enum.concat(keys_from_range(chunk_checkpoint_start(), chunk_checkpoint_end(), opts))
    |> then(&CubDB.delete_multi(db, &1))

    {:ok, _} = File.rm_rf(opts.snapshot_dir)
    {:ok, _} = File.rm_rf(shape_definition_path(opts))
    :ok = File.mkdir_p!(opts.snapshot_dir)

    :ok
  end

  @impl Electric.ShapeCache.Storage
  def terminate(%FS{} = _opts), do: :ok

  @impl Electric.ShapeCache.Storage
  def hibernate(%FS{} = _opts), do: :ok

  @impl Electric.ShapeCache.Storage
  def cleanup!(%FS{} = opts) do
    cleanup!(opts, opts.shape_handle)
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%FS{} = opts, shape_handle) do
    # do a quick touch operation to exclude this directory from `get_all_stored_shapes`
    marker_file = deletion_marker_path(opts.base_path, shape_handle)

    try do
      File.touch!(marker_file)
      unsafe_cleanup_with_retries!(opts.data_dir)
    after
      File.rm(marker_file)
    end
  end

  @impl Electric.ShapeCache.Storage
  def cleanup_all!(%{base_path: base_path}) do
    unsafe_cleanup_with_retries!(base_path)
  end

  @doc false
  # used in tests
  def deletion_marker_path(base_path, shape_handle) do
    Path.join([base_path, ".#{shape_handle}-deleted"])
  end

  defp unsafe_cleanup_with_retries!(directory, attempts_left \\ 5) do
    with {:ok, _} <- File.rm_rf(directory) do
      :ok
    else
      # There is a very unlikely but observed scenario where the rm_rf call
      # tries to delete a directory after having deleted all its files, but
      # due to some FS race the deletion fails with EEXIST. Very hard to test
      # and prevent so we mitigate it with arbitrary retries.
      {:error, :eexist, _} when attempts_left > 0 ->
        unsafe_cleanup_with_retries!(directory, attempts_left - 1)

      {:error, reason, path} ->
        raise File.Error,
          reason: reason,
          path: path,
          action: "remove files and directories recursively from"
    end
  end

  defp shape_definition_path(%{data_dir: data_dir} = _opts) do
    Path.join(data_dir, @shape_definition_file_name)
  end

  defp keys_from_range(min_key, max_key, opts) do
    opts.db
    |> validate_db_process!()
    |> CubDB.select(min_key: min_key, max_key: max_key)
    |> Stream.map(&elem(&1, 0))
  end

  defp stored_version(opts) do
    opts.db
    |> validate_db_process!()
    |> CubDB.get(@version_key)
  end

  defp snapshot_offset(chunk_number), do: LogOffset.new(0, chunk_number)

  # Key helpers
  defp log_key(offset), do: {:log, LogOffset.to_tuple(offset)}
  defp log_start, do: log_key(LogOffset.first())
  defp log_end, do: log_key(LogOffset.last())

  defp chunk_checkpoint_key(offset), do: {:chunk, LogOffset.to_tuple(offset)}
  defp chunk_checkpoint_start(), do: chunk_checkpoint_key(LogOffset.first())
  defp chunk_checkpoint_end(), do: chunk_checkpoint_key(LogOffset.last())
end
