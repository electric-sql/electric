defmodule Electric.ShapeCache.FileStorage do
  use Retry
  require Logger

  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Replication.LogOffset
  import Electric.Replication.LogOffset, only: :macros
  alias __MODULE__, as: FS

  # If the storage format changes, increase `@version` to prevent
  # the incompatable older versions being read
  @version 2
  @version_key :version

  @shape_definition_file_name "shape_defintion.json"

  @xmin_key :snapshot_xmin
  @snapshot_meta_key :snapshot_meta
  @snapshot_started_key :snapshot_started

  @behaviour Electric.ShapeCache.Storage

  defstruct [
    :base_path,
    :shape_handle,
    :db,
    :data_dir,
    :cubdb_dir,
    :snapshot_dir,
    :stack_id,
    :extra_opts,
    version: @version
  ]

  @impl Electric.ShapeCache.Storage
  def shared_opts(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")

    # Always scope the provided storage dir by stack id
    %{base_path: Path.join(storage_dir, stack_id), stack_id: stack_id}
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
      stack_id: stack_id,
      extra_opts: Map.get(opts, :extra_opts, %{})
    }
  end

  defp name(stack_id, shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def child_spec(%FS{} = opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      type: :worker,
      restart: :permanent
    }
  end

  @impl Electric.ShapeCache.Storage
  def start_link(%FS{cubdb_dir: dir, db: db} = opts) do
    with :ok <- initialise_filesystem(opts) do
      CubDB.start_link(
        data_dir: dir,
        name: db,
        hibernate_after: Electric.Config.get_env(:shape_hibernate_after)
      )
    end
  end

  defp initialise_filesystem(opts) do
    with :ok <- File.mkdir_p(opts.data_dir),
         :ok <- File.mkdir_p(opts.cubdb_dir),
         :ok <- File.mkdir_p(opts.snapshot_dir) do
      :ok
    end
  end

  @impl Electric.ShapeCache.Storage
  def initialise(%FS{} = opts) do
    stored_version = stored_version(opts)

    if stored_version != opts.version || snapshot_xmin(opts) == nil ||
         not File.exists?(shape_definition_path(opts)) ||
         not CubDB.has_key?(opts.db, @snapshot_meta_key) do
      cleanup_internals!(opts)
    end

    if File.exists?(old_snapshot_path(opts)) do
      # This shape has had the snapshot written before we started using the new format.
      # We need to move the old snapshot into the new format and store correct metadata
      # so that we know it's complete.
      File.rename(old_snapshot_path(opts), snapshot_chunk_path(opts, 0))
      CubDB.put(opts.db, @snapshot_meta_key, LogOffset.new(0, 0))
    end

    CubDB.put(opts.db, @version_key, @version)
  end

  defp old_snapshot_path(opts) do
    Path.join([opts.snapshot_dir, "snapshot.jsonl"])
  end

  @impl Electric.ShapeCache.Storage
  def set_shape_definition(shape, %FS{} = opts) do
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
  def get_all_stored_shapes(opts) do
    shapes_dir = opts.base_path

    case File.ls(shapes_dir) do
      {:ok, shape_handles} ->
        Enum.reduce(shape_handles, %{}, fn shape_handle, acc ->
          shape_def_path =
            shape_definition_path(%{
              data_dir: Path.join([opts.base_path, shape_handle])
            })

          with {:ok, shape_def_encoded} <- File.read(shape_def_path),
               {:ok, shape_def_json} <- Jason.decode(shape_def_encoded),
               shape = Electric.Shapes.Shape.from_json_safe!(shape_def_json) do
            Map.put(acc, shape_handle, shape)
          else
            # if the shape definition file cannot be read/decoded, just ignore it
            {:error, _reason} -> acc
          end
        end)
        |> then(&{:ok, &1})

      {:error, :enoent} ->
        # if not present, there's no stored shapes
        {:ok, %{}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_total_disk_usage(%{base_path: shapes_dir} = opts) do
    case File.ls(shapes_dir) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.map(&for_shape(&1, opts))
        |> Enum.map(fn fs ->
          maybe_get_size(shape_definition_path(fs)) +
            get_all_chunk_sizes(fs) +
            maybe_get_size(CubDB.current_db_file(fs.db))
        end)
        |> Enum.sum()

      _ ->
        0
    end
  end

  defp get_all_chunk_sizes(%FS{} = opts) do
    case File.ls(opts.snapshot_dir) do
      {:ok, chunk_files} -> chunk_files |> Enum.map(&maybe_get_size/1) |> Enum.sum()
      _ -> 0
    end
  end

  defp maybe_get_size(path) do
    case File.stat(path) do
      {:ok, stat} -> stat.size
      {:error, _} -> 0
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_current_position(%FS{} = opts) do
    {:ok, latest_offset(opts), snapshot_xmin(opts)}
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
    case CubDB.select(opts.db,
           min_key: log_start(),
           max_key: log_end(),
           min_key_inclusive: true,
           reverse: true
         )
         |> Enum.take(1) do
      [{key, _}] -> offset(key)
      _ -> nil
    end
  end

  defp snapshot_xmin(opts) do
    CubDB.get(opts.db, @xmin_key)
  end

  @impl Electric.ShapeCache.Storage
  def set_snapshot_xmin(xmin, %FS{} = opts) do
    CubDB.put(opts.db, @xmin_key, xmin)
  end

  @impl Electric.ShapeCache.Storage
  def snapshot_started?(%FS{} = opts) do
    CubDB.has_key?(opts.db, @snapshot_started_key)
  end

  @impl Electric.ShapeCache.Storage
  def mark_snapshot_as_started(%FS{} = opts) do
    CubDB.put(opts.db, @snapshot_started_key, true)
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

        CubDB.put(opts.db, @snapshot_meta_key, LogOffset.new(0, last_chunk_num))
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

  defp snapshot_chunk_path(opts, chunk_number)
       when is_integer(chunk_number) and chunk_number >= 0 do
    Path.join([opts.snapshot_dir, "snapshot_chunk.#{chunk_number}.jsonl"])
  end

  @impl Electric.ShapeCache.Storage
  def append_to_log!(log_items, %FS{} = opts) do
    retry with: linear_backoff(50, 2) |> expiry(5_000) do
      log_items
      |> Enum.map(fn
        {:chunk_boundary, offset} -> {chunk_checkpoint_key(offset), nil}
        {offset, json_log_item} -> {log_key(offset), json_log_item}
      end)
      |> then(&CubDB.put_multi(opts.db, &1))
    else
      error -> raise(error)
    end

    :ok
  end

  @impl Electric.ShapeCache.Storage
  def get_log_stream(
        %LogOffset{tx_offset: tx_offset, op_offset: op_offset} = offset,
        max_offset,
        %FS{} = opts
      )
      when tx_offset <= 0 do
    unless snapshot_started?(opts), do: raise("Snapshot not started")

    case {CubDB.get(opts.db, @snapshot_meta_key), offset} do
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

  # This function raises if the chunk file doesn't exist.
  defp stream_snapshot_chunk!(%FS{} = opts, chunk_number) do
    Stream.resource(
      fn -> {open_snapshot_chunk(opts, chunk_number), nil} end,
      fn {file, eof_seen} ->
        case IO.binread(file, :line) do
          {:error, reason} ->
            raise IO.StreamError, reason: reason

          :eof ->
            cond do
              is_nil(eof_seen) ->
                # First time we see eof after any valid lines, we store a timestamp
                {[], {file, System.monotonic_time(:millisecond)}}

              # If it's been 60s without any new lines, and also we've not seen <<4>>,
              # then likely something is wrong
              System.monotonic_time(:millisecond) - eof_seen > 60_000 ->
                raise "Snapshot hasn't updated in 60s"

              true ->
                # Sleep a little and check for new lines
                Process.sleep(20)
                {[], {file, eof_seen}}
            end

          # The 4 byte marker (ASCII "end of transmission") indicates the end of the snapshot file.
          <<4::utf8>> ->
            {:halt, {file, nil}}

          line ->
            {[line], {file, nil}}
        end
      end,
      fn {file, _} -> File.close(file) end
    )
  end

  defp open_snapshot_chunk(opts, chunk_num, attempts_left \\ 100)
  defp open_snapshot_chunk(_, _, 0), do: raise(IO.StreamError, reason: :enoent)

  defp open_snapshot_chunk(opts, chunk_num, attempts_left) do
    case File.open(snapshot_chunk_path(opts, chunk_num), [:read, :raw, read_ahead: 1024]) do
      {:ok, file} ->
        file

      {:error, :enoent} ->
        Process.sleep(20)
        open_snapshot_chunk(opts, chunk_num, attempts_left - 1)

      {:error, reason} ->
        raise IO.StreamError, reason: reason
    end
  end

  defp stream_log_chunk(%LogOffset{} = offset, max_offset, %FS{} = opts) do
    opts.db
    |> CubDB.select(
      min_key: log_key(offset),
      max_key: log_key(max_offset),
      min_key_inclusive: false
    )
    |> Stream.map(fn {_, item} -> item end)
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
      File.exists?(path, [:raw]) ->
        stream_snapshot_chunk!(opts, chunk_number)

      CubDB.has_key?(opts.db, @snapshot_meta_key) ->
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
    CubDB.select(opts.db,
      min_key: chunk_checkpoint_key(offset),
      max_key: chunk_checkpoint_end(),
      min_key_inclusive: false
    )
    |> Stream.map(fn {key, _} -> offset(key) end)
    |> Enum.take(1)
    |> Enum.at(0)
  end

  defp get_last_snapshot_offset(%FS{} = opts) do
    CubDB.get(opts.db, @snapshot_meta_key)
  end

  defp cleanup_internals!(%FS{} = opts) do
    [
      @snapshot_meta_key,
      @xmin_key,
      @snapshot_started_key
    ]
    |> Enum.concat(keys_from_range(log_start(), log_end(), opts))
    |> Enum.concat(keys_from_range(chunk_checkpoint_start(), chunk_checkpoint_end(), opts))
    |> then(&CubDB.delete_multi(opts.db, &1))

    {:ok, _} = File.rm_rf(opts.snapshot_dir)
    {:ok, _} = File.rm_rf(shape_definition_path(opts))
    :ok = File.mkdir_p!(opts.snapshot_dir)

    :ok
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%FS{} = opts) do
    :ok = cleanup_internals!(opts)
    {:ok, _} = File.rm_rf(opts.data_dir)
    :ok
  end

  @impl Electric.ShapeCache.Storage
  def unsafe_cleanup!(%FS{} = opts) do
    {:ok, _} = File.rm_rf(opts.data_dir)
    :ok
  end

  defp shape_definition_path(%{data_dir: data_dir} = _opts) do
    Path.join(data_dir, @shape_definition_file_name)
  end

  defp keys_from_range(min_key, max_key, opts) do
    CubDB.select(opts.db, min_key: min_key, max_key: max_key)
    |> Stream.map(&elem(&1, 0))
  end

  defp stored_version(opts) do
    CubDB.get(opts.db, @version_key)
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
