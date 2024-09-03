defmodule Electric.ShapeCache.CubDbStorage do
  require Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.LogChunker
  alias Electric.ConcurrentStream
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry.OpenTelemetry

  @behaviour Electric.ShapeCache.Storage

  # If the storage format changes, increase `@version` to prevent
  # the incompatable older versions being read
  @version 1
  @version_key :version
  @snapshot_key_type 0
  @log_key_type 1
  @chunk_checkpoint_key_type 2
  @snapshot_offset LogOffset.first()

  def shared_opts(opts) do
    base_path = Access.get(opts, :file_path, "./shapes")

    chunk_bytes_threshold =
      Access.get(opts, :chunk_bytes_threshold, LogChunker.default_chunk_size_threshold())

    {:ok,
     %{
       base_path: base_path,
       shape_id: nil,
       db: nil,
       version: @version,
       chunk_bytes_threshold: chunk_bytes_threshold
     }}
  end

  def for_shape(shape_id, %{shape_id: shape_id} = opts) do
    opts
  end

  def for_shape(shape_id, %{} = opts) do
    %{
      opts
      | shape_id: shape_id,
        db: name(shape_id)
    }
  end

  def start_link(%{shape_id: shape_id, db: db} = opts) when is_binary(shape_id) do
    with {:ok, path} <- initialise_filesystem(shape_id, opts) do
      CubDB.start_link(data_dir: path, name: db)
    end
  end

  defp name(shape_id) do
    Electric.Application.process_name(__MODULE__, shape_id)
  end

  defp initialise_filesystem(shape_id, opts) do
    path = Path.join(opts.base_path, shape_id)

    with :ok <- File.mkdir_p(path) do
      {:ok, path}
    end
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

  def get_chunk_end_log_offset(shape_id, offset, opts) do
    CubDB.select(opts.db,
      min_key: chunk_checkpoint_key(shape_id, offset),
      max_key: chunk_checkpoint_end(shape_id),
      min_key_inclusive: false
    )
    |> Stream.map(fn {key, _} -> offset(key) end)
    |> Enum.take(1)
    |> Enum.at(0)
  end

  def has_shape?(shape_id, opts) do
    entry_stream = keys_from_range(log_start(shape_id), log_end(shape_id), opts)
    !Enum.empty?(entry_stream) or snapshot_started?(shape_id, opts)
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

  def append_to_log!(shape_id, log_items, log_state, opts) do
    chunk_bytes_threshold = Access.fetch!(opts, :chunk_bytes_threshold)

    log_items
    |> Enum.flat_map_reduce(log_state, fn log_item, log_state ->
      json_log_item = Jason.encode!(log_item)
      log_key = log_key(shape_id, log_item.offset)
      current_chunk_size = log_state.current_chunk_byte_size

      case LogChunker.add_to_chunk(json_log_item, current_chunk_size, chunk_bytes_threshold) do
        {:ok, new_chunk_size} ->
          {
            [{log_key, json_log_item}],
            %{log_state | current_chunk_byte_size: new_chunk_size}
          }

        {:threshold_exceeded, new_chunk_size} ->
          {
            [
              {log_key, json_log_item},
              {chunk_checkpoint_key(shape_id, log_item.offset), nil}
            ],
            %{log_state | current_chunk_byte_size: new_chunk_size}
          }
      end
    end)
    |> then(fn {items, log_state} ->
      CubDB.put_multi(opts.db, items)
      log_state
    end)
  end

  def cleanup!(shape_id, opts) do
    [
      shape_key(shape_id),
      xmin_key(shape_id)
    ]
    |> Stream.concat(keys_from_range(snapshot_start(shape_id), snapshot_end(shape_id), opts))
    |> Stream.concat(keys_from_range(log_start(shape_id), log_end(shape_id), opts))
    |> Stream.concat(
      keys_from_range(chunk_checkpoint_start(shape_id), chunk_checkpoint_end(shape_id), opts)
    )
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

  defp chunk_checkpoint_key(shape_id, checkpoint_offset) do
    {shape_id, @chunk_checkpoint_key_type, LogOffset.to_tuple(checkpoint_offset)}
  end

  defp shape_key(shape_id) do
    {:shapes, shape_id}
  end

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

  defp offset({_shape_id, @chunk_checkpoint_key_type, tuple_offset}),
    do: LogOffset.new(tuple_offset)

  defp log_start(shape_id), do: log_key(shape_id, LogOffset.first())
  defp log_end(shape_id), do: log_key(shape_id, LogOffset.last())

  defp chunk_checkpoint_start(shape_id), do: chunk_checkpoint_key(shape_id, LogOffset.first())
  defp chunk_checkpoint_end(shape_id), do: chunk_checkpoint_key(shape_id, LogOffset.last())

  defp snapshot_start(shape_id), do: snapshot_key(shape_id, -1)
  defp snapshot_end(shape_id), do: snapshot_key(shape_id, :end)

  defp stored_version(opts) do
    CubDB.get(opts.db, @version_key)
  end
end
