defmodule Electric.ShapeCache.CubDbStorage do
  alias Electric.LogItems
  alias Electric.Replication.LogOffset
  @behaviour Electric.ShapeCache.Storage

  @snapshot_key_type 0
  @log_key_type 1
  @snapshot_offset LogOffset.first()

  def shared_opts(opts) do
    file_path = Access.get(opts, :file_path, "./shapes")
    db = Access.get(opts, :db, :shape_db)

    {:ok, %{file_path: file_path, db: db}}
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
    File.mkdir_p(opts.file_path)
    CubDB.start_link(data_dir: opts.file_path, name: opts.db)
  end

  def cleanup_shapes_without_xmins(opts) do
    opts.db
    |> CubDB.select(min_key: shapes_start(), max_key: shapes_end())
    |> Stream.map(fn {{:shapes, shape_id}, _} -> shape_id end)
    |> Stream.reject(&snapshot_xmin(&1, opts))
    |> Enum.each(&cleanup!(&1, opts))
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

  def add_shape(shape_id, shape, opts) do
    CubDB.put(opts.db, shape_key(shape_id), shape)
  end

  def set_snapshot_xmin(shape_id, xmin, opts) do
    CubDB.put(opts.db, xmin_key(shape_id), xmin)
  end

  defp snapshot_xmin(shape_id, opts) do
    CubDB.get(opts.db, xmin_key(shape_id))
  end

  defp latest_offset(shape_id, opts) do
    case CubDB.select(opts.db,
           min_key: snapshot_start(shape_id),
           max_key: log_end(shape_id),
           reverse: true
         )
         |> Enum.take(1) do
      [{key, _}] ->
        offset(key)

      _ ->
        LogOffset.first()
    end
  end

  @spec snapshot_exists?(any(), any()) :: false
  def snapshot_exists?(shape_id, opts) do
    CubDB.has_key?(opts.db, snapshot_meta_key(shape_id))
  end

  def get_snapshot(shape_id, opts) do
    stream =
      opts.db
      |> CubDB.select(
        min_key: snapshot_start(shape_id),
        max_key: snapshot_end(shape_id)
      )
      |> Stream.flat_map(fn {_, items} -> items end)
      |> Stream.map(fn {_, item} -> item end)

    # FIXME: this is naive while we don't have snapshot metadata to get real offset
    {@snapshot_offset, stream}
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
      (snapshot_exists?(shape_id, opts) and offset == @snapshot_offset)
  end

  def make_new_snapshot!(shape_id, shape, query_info, data_stream, opts) do
    data_stream
    |> LogItems.from_snapshot_row_stream(@snapshot_offset, shape, query_info)
    |> Stream.with_index()
    |> Stream.map(fn {log_item, index} ->
      {snapshot_key(shape_id, index), Jason.encode!(log_item)}
    end)
    |> Stream.chunk_every(500)
    |> Stream.each(fn [{key, _} | _] = chunk -> CubDB.put(opts.db, key, chunk) end)
    |> Stream.run()

    CubDB.put(opts.db, snapshot_meta_key(shape_id), 0)
  end

  def append_to_log!(shape_id, log_items, opts) do
    log_items
    |> Enum.map(fn log_item -> {log_key(shape_id, log_item.offset), Jason.encode!(log_item)} end)
    |> then(&CubDB.put_multi(opts.db, &1))

    :ok
  end

  def cleanup!(shape_id, opts) do
    [
      snapshot_meta_key(shape_id),
      shape_key(shape_id),
      xmin_key(shape_id)
    ]
    |> Stream.concat(keys_from_range(snapshot_start(shape_id), snapshot_end(shape_id), opts))
    |> Stream.concat(keys_from_range(log_start(shape_id), log_end(shape_id), opts))
    |> then(&CubDB.delete_multi(opts.db, &1))
  end

  defp keys_from_range(min_key, max_key, opts) do
    CubDB.select(opts.db, min_key: min_key, max_key: max_key)
    |> Stream.map(&elem(&1, 0))
  end

  defp snapshot_meta_key(shape_id) do
    {:snapshot_metadata, shape_id}
  end

  defp snapshot_key(shape_id, index) do
    {shape_id, @snapshot_key_type, index}
  end

  defp log_key(shape_id, offset) do
    {shape_id, @log_key_type, LogOffset.to_tuple(offset)}
  end

  defp shape_key(shape_id) do
    {:shapes, shape_id}
  end

  def xmin_key(shape_id) do
    {:snapshot_xmin, shape_id}
  end

  defp shapes_start, do: shape_key(0)
  defp shapes_end, do: shape_key("zzz-end")

  # FIXME: this is naive while we don't have snapshot metadata to get real offsets
  defp offset({_shape_id, @snapshot_key_type, _index}), do: @snapshot_offset

  defp offset({_shape_id, @log_key_type, tuple_offset}),
    do: LogOffset.new(tuple_offset)

  defp log_start(shape_id), do: log_key(shape_id, LogOffset.first())
  defp log_end(shape_id), do: log_key(shape_id, LogOffset.last())

  defp snapshot_start(shape_id), do: snapshot_key(shape_id, 0)
  defp snapshot_end(shape_id), do: snapshot_key(shape_id, :end)
end
