defmodule Electric.ShapeCache.MixedDiskStorage do
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Replication.LogOffset
  @behaviour Electric.ShapeCache.Storage

  @version 1
  @version_key :version

  def shared_opts(opts) do
    storage_dir = Access.get(opts, :storage_dir, "./shapes")
    db = Access.get(opts, :db, :mixed_shape_db)

    {:ok, %{storage_dir: storage_dir, db: db, version: @version}}
  end

  def child_spec(opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      type: :worker,
      restart: :permanent
    }
  end

  def start_link(opts) do
    File.mkdir_p(opts.storage_dir)
    File.mkdir_p(Path.join([opts.storage_dir, "cubdb"]))
    File.mkdir_p(Path.join([opts.storage_dir, "shapes"]))
    CubDB.start_link(data_dir: Path.join([opts.storage_dir, "cubdb"]), name: opts.db)
  end

  def add_shape(shape_id, shape, opts) do
    CubDB.put(opts.db, shape_key(shape_id), shape)
  end

  def set_snapshot_xmin(shape_id, xmin, opts) do
    CubDB.put(opts.db, xmin_key(shape_id), xmin)
  end

  defp snapshot_xmin(shape_id, opts) do
    CubDB.get(opts.db, xmin_key(shape_id))
  end

  def list_shapes(opts) do
    opts.db
    |> CubDB.select(min_key: shapes_start(), max_key: shapes_end())
    |> Enum.map(fn {{:shapes, shape_id}, shape} ->
      %{
        shape_id: shape_id,
        shape: shape,
        latest_offset: latest_offset(shape_id, opts),
        snapshot_xmin: snapshot_xmin(shape_id, opts)
      }
    end)
  end

  def initialise(opts) do
    stored_version = stored_version(opts)

    opts.db
    |> CubDB.select(min_key: shapes_start(), max_key: shapes_end())
    |> Stream.map(fn {{:shapes, shape_id}, _} -> shape_id end)
    |> Stream.filter(fn shape_id ->
      stored_version != opts.version ||
        snapshot_xmin(shape_id, opts) == nil ||
        not CubDB.has_key?(opts.db, snapshot_meta_key(shape_id))
    end)
    |> Enum.each(&cleanup!(&1, opts))

    CubDB.put(opts.db, @version_key, @version)
  end

  def snapshot_started?(shape_id, opts) do
    CubDB.has_key?(opts.db, snapshot_started_key(shape_id))
  end

  def mark_snapshot_as_started(shape_id, opts) do
    CubDB.put(opts.db, snapshot_started_key(shape_id), true)
  end

  defp latest_offset(shape_id, opts) do
    case CubDB.select(opts.db,
           min_key: log_start(shape_id),
           max_key: log_end(shape_id),
           min_key_inclusive: true,
           reverse: true
         )
         |> Enum.take(1) do
      [{key, _}] ->
        offset(key)

      _ ->
        LogOffset.first()
    end
  end

  defp offset({_shape_id, :log, tuple_offset}), do: LogOffset.new(tuple_offset)

  def make_new_snapshot!(shape_id, data_stream, opts) do
    OpenTelemetry.with_span("storage.make_new_snapshot", [storage_impl: "mixed_disk"], fn ->
      data_stream
      |> Stream.map(&[String.replace(&1, "\n", "\\n"), "\n"])
      # Use the 4 byte marker (ASCII "end of transmission") to indicate the end of the snapshot,
      # so that concurrent readers can detect that the snapshot has been completed.
      |> Stream.concat([<<4::utf8>>])
      |> Stream.into(File.stream!(shape_snapshot_path(shape_id, opts), [:append, :delayed_write]))
      |> Stream.run()

      CubDB.put(opts.db, snapshot_meta_key(shape_id), LogOffset.first())
    end)
  end

  def snapshot_exists?(shape_id, opts) do
    CubDB.has_key?(opts.db, snapshot_meta_key(shape_id))
  end

  def get_snapshot(shape_id, opts) do
    if snapshot_started?(shape_id, opts) do
      {LogOffset.first(),
       Stream.resource(
         fn -> open_snapshot_file(shape_id, opts) end,
         fn file ->
           case IO.binread(file, :line) do
             {:error, reason} ->
               raise IO.StreamError, reason: reason

             :eof ->
               Process.sleep(10)
               {[], file}

             # The 4 byte marker (ASCII "end of transmission") indicates the end of the snapshot file.
             <<4::utf8>> ->
               {:halt, file}

             line ->
               {[line], file}
           end
         end,
         &File.close/1
       )}
    else
      raise "Snapshot no longer available"
    end
  end

  defp open_snapshot_file(shape_id, opts) do
    case File.open(shape_snapshot_path(shape_id, opts), [:read, :raw, read_ahead: 1024]) do
      {:ok, file} -> file
      {:error, :enoent} -> open_snapshot_file(shape_id, opts)
      {:error, reason} -> raise IO.StreamError, reason: reason
    end
  end

  def append_to_log!(shape_id, log_items, opts) do
    log_items
    |> Enum.map(fn log_item -> {log_key(shape_id, log_item.offset), Jason.encode!(log_item)} end)
    |> then(&CubDB.put_multi(opts.db, &1))

    :ok
  end

  def get_log_stream(shape_id, offset, max_offset, opts) do
    max_key =
      if max_offset == :infinity, do: log_end(shape_id), else: log_key(shape_id, max_offset)

    opts.db
    |> CubDB.select(
      min_key: log_key(shape_id, offset),
      max_key: max_key,
      min_key_inclusive: false
    )
    |> Stream.map(fn {_, item} -> item end)
  end

  def has_log_entry?(shape_id, offset, opts) do
    # FIXME: this is naive while we don't have snapshot metadata to get real offsets
    CubDB.has_key?(opts.db, log_key(shape_id, offset)) or
      (snapshot_started?(shape_id, opts) and offset == LogOffset.first())
  end

  def cleanup!(shape_id, opts) do
    [
      snapshot_meta_key(shape_id),
      shape_key(shape_id),
      xmin_key(shape_id),
      snapshot_started_key(shape_id)
    ]
    |> Enum.concat(keys_from_range(log_start(shape_id), log_end(shape_id), opts))
    |> then(&CubDB.delete_multi(opts.db, &1))

    File.rm_rf(shape_snapshot_path(shape_id, opts))
  end

  defp keys_from_range(min_key, max_key, opts) do
    CubDB.select(opts.db, min_key: min_key, max_key: max_key)
    |> Stream.map(&elem(&1, 0))
  end

  defp shape_snapshot_path(shape_id, opts) do
    Path.join([opts.storage_dir, "shapes", "#{shape_id}_snapshot.jsonl"])
  end

  defp stored_version(opts) do
    CubDB.get(opts.db, @version_key)
  end

  # Key helpers
  defp shape_key(shape_id), do: {:shapes, shape_id}
  defp xmin_key(shape_id), do: {:snapshot_xmin, shape_id}
  defp snapshot_meta_key(shape_id), do: {:snapshot_meta, shape_id}
  defp log_key(shape_id, offset), do: {shape_id, :log, LogOffset.to_tuple(offset)}
  defp log_start(shape_id), do: log_key(shape_id, LogOffset.first())
  defp log_end(shape_id), do: log_key(shape_id, LogOffset.last())
  defp shapes_start, do: shape_key(0)
  defp shapes_end, do: shape_key("zzz-end")
  defp snapshot_started_key(shape_id), do: {:snapshot_started, shape_id}
end
