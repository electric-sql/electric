defmodule Electric.ShapeCache.CubDbStorage do
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes
  alias Electric.Utils
  alias Electric.Shapes.Shape
  @behaviour Electric.ShapeCache.Storage

  @snapshot_key_type 0
  @log_key_type 1

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
    results =
      opts.db
      |> CubDB.select(
        min_key: snapshot_start(shape_id),
        max_key: snapshot_end(shape_id)
      )
      |> Stream.flat_map(fn {_, items} -> items end)
      |> Stream.map(&storage_item_to_log_item/1)
      |> Enum.to_list()

    # FIXME: this is naive while we don't have snapshot metadata to get real offset
    {LogOffset.first(), results}
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
    |> Stream.map(&storage_item_to_log_item/1)
  end

  def has_log_entry?(shape_id, offset, opts) do
    # FIXME: this is naive while we don't have snapshot metadata to get real offsets
    CubDB.has_key?(opts.db, log_key(shape_id, offset)) or
      (snapshot_exists?(shape_id, opts) and offset == LogOffset.first())
  end

  def make_new_snapshot!(shape_id, shape, query_info, data_stream, opts) do
    data_stream
    |> Stream.with_index()
    |> Stream.map(&row_to_snapshot_item(&1, shape_id, shape, query_info))
    |> Stream.chunk_every(500)
    |> Stream.each(fn [{key, _} | _] = chunk -> CubDB.put(opts.db, key, chunk) end)
    |> Stream.run()

    CubDB.put(opts.db, snapshot_meta_key(shape_id), 0)
  end

  def append_to_log!(shape_id, xid, changes, opts) do
    changes
    |> Enum.map(fn
      %{relation: _, key: change_key} = change ->
        value = Changes.to_json_value(change)
        action = Changes.get_action(change)
        offset = Changes.get_log_offset(change)
        {log_key(shape_id, offset), {xid, change_key, action, value}}
    end)
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
  defp offset({_shape_id, @snapshot_key_type, _index}), do: LogOffset.first()

  defp offset({_shape_id, @log_key_type, tuple_offset}),
    do: LogOffset.new(tuple_offset)

  defp log_start(shape_id), do: log_key(shape_id, LogOffset.first())
  defp log_end(shape_id), do: log_key(shape_id, LogOffset.last())

  defp snapshot_start(shape_id), do: snapshot_key(shape_id, 0)
  defp snapshot_end(shape_id), do: snapshot_key(shape_id, :end)

  defp row_to_snapshot_item({row, index}, shape_id, shape, %Postgrex.Query{
         columns: columns,
         result_types: types
       }) do
    serialized_row =
      [columns, types, row]
      |> Enum.zip_with(fn
        [col, Postgrex.Extensions.UUID, val] -> {col, Utils.encode_uuid(val)}
        [col, _, val] -> {col, val}
      end)
      |> Map.new()

    change_key = Changes.build_key(shape.root_table, serialized_row, Shape.pk(shape))

    {snapshot_key(shape_id, index), {_xid = nil, change_key, "insert", serialized_row}}
  end

  defp storage_item_to_log_item({key, {xid, change_key, action, value}}) do
    %{key: change_key, value: value, headers: headers(action, xid), offset: offset(key)}
  end

  defp headers(action, nil = _xid), do: %{action: action}
  defp headers(action, xid), do: %{action: action, txid: xid}
end
