defmodule Electric.ShapeCache.CubDbStorage do
  alias Electric.ConcurrentStream
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.Relation
  alias Electric.Telemetry.OpenTelemetry
  @behaviour Electric.ShapeCache.Storage

  # If the storage format changes, increase `@version` to prevent
  # the incompatable older versions being read
  @version 1
  @version_key :version
  @snapshot_key_type 0
  @log_key_type 1
  @snapshot_offset LogOffset.first()

  def shared_opts(opts) do
    file_path = Access.get(opts, :file_path, "./shapes")
    db = Access.get(opts, :db, :shape_db)

    {:ok, %{file_path: file_path, db: db, version: @version}}
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

  def initialise(opts) do
    stored_version = stored_version(opts)

    opts.db
    |> CubDB.select(min_key: shapes_start(), max_key: shapes_end())
    |> Stream.map(fn {{:shapes, shape_id}, _} -> shape_id end)
    |> Stream.filter(fn shape_id ->
      stored_version != opts.version ||
        snapshot_xmin(shape_id, opts) == nil ||
        CubDB.has_key?(opts.db, snapshot_end(shape_id)) == false
    end)
    |> Enum.each(&cleanup!(&1, opts))

    CubDB.put(opts.db, @version_key, @version)
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

  @spec snapshot_started?(any(), any()) :: false
  def snapshot_started?(shape_id, opts) do
    CubDB.has_key?(opts.db, snapshot_start(shape_id))
  end

  def get_snapshot(shape_id, opts) do
    stream =
      ConcurrentStream.stream_to_end(
        excluded_start_key: snapshot_start(shape_id),
        end_marker_key: snapshot_end(shape_id),
        poll_time_in_ms: 10,
        stream_fun: fn excluded_start_key, included_end_key ->
          if !snapshot_started?(shape_id, opts), do: raise("Snapshot no longer available")

          CubDB.select(opts.db,
            min_key: excluded_start_key,
            max_key: included_end_key,
            min_key_inclusive: false
          )
        end
      )
      |> Stream.flat_map(fn {_, items} -> items end)

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
      (snapshot_started?(shape_id, opts) and offset == @snapshot_offset)
  end

  def mark_snapshot_as_started(shape_id, opts) do
    CubDB.put(opts.db, snapshot_start(shape_id), 0)
  end

  def make_new_snapshot!(shape_id, data_stream, opts) do
    OpenTelemetry.with_span("storage.make_new_snapshot", [storage_impl: "cub_db"], fn ->
      data_stream
      |> Stream.chunk_every(500)
      |> Stream.with_index(fn chunk, i -> CubDB.put(opts.db, snapshot_key(shape_id, i), chunk) end)
      |> Stream.run()

      CubDB.put(opts.db, snapshot_end(shape_id), 0)
    end)
  end

  def append_to_log!(shape_id, log_items, opts) do
    log_items
    |> Enum.map(fn log_item -> {log_key(shape_id, log_item.offset), Jason.encode!(log_item)} end)
    |> then(&CubDB.put_multi(opts.db, &1))

    :ok
  end

  def store_relation(%Relation{id: id} = rel, opts) do
    CubDB.put(opts.db, relation_key(id), rel)
  end

  def get_relations(opts) do
    CubDB.select(opts.db, min_key: relations_start(), max_key: relations_end())
    |> Stream.map(fn {_key, value} -> value end)
  end

  def cleanup!(shape_id, opts) do
    [
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

  defp snapshot_key(shape_id, index) do
    {shape_id, @snapshot_key_type, index}
  end

  defp log_key(shape_id, offset) do
    {shape_id, @log_key_type, LogOffset.to_tuple(offset)}
  end

  defp shape_key(shape_id) do
    {:shapes, shape_id}
  end

  defp relation_key(relation_id) do
    {:relations, relation_id}
  end

  defp relations_start, do: relation_key(0)
  # Atoms are always bigger than numbers
  # Thus this key is bigger than any possible relation key
  defp relations_end, do: relation_key(:max)

  def xmin_key(shape_id) do
    {:snapshot_xmin, shape_id}
  end

  defp shapes_start, do: shape_key("")
  # Since strings in Elixir are encoded using UTF-8,
  # it is impossible for any valid string to contain byte value 255.
  # Thus any key will be smaller than this one.
  defp shapes_end, do: shape_key(<<255>>)

  # FIXME: this is naive while we don't have snapshot metadata to get real offsets
  defp offset({_shape_id, @snapshot_key_type, _index}), do: @snapshot_offset

  defp offset({_shape_id, @log_key_type, tuple_offset}),
    do: LogOffset.new(tuple_offset)

  defp log_start(shape_id), do: log_key(shape_id, LogOffset.first())
  defp log_end(shape_id), do: log_key(shape_id, LogOffset.last())

  defp snapshot_start(shape_id), do: snapshot_key(shape_id, -1)
  defp snapshot_end(shape_id), do: snapshot_key(shape_id, :end)

  defp stored_version(opts) do
    CubDB.get(opts.db, @version_key)
  end
end
