defmodule Electric.ShapeCache.FileStorage do
  use Retry

  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Replication.LogOffset
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
    :cubdb_dir,
    :shape_definition_dir,
    :snapshot_dir,
    :electric_instance_id,
    :tenant_id,
    :extra_opts,
    version: @version
  ]

  @impl Electric.ShapeCache.Storage
  def shared_opts(opts) do
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")
    electric_instance_id = Keyword.fetch!(opts, :electric_instance_id)
    tenant_id = Keyword.fetch!(opts, :tenant_id)

    %{base_path: storage_dir, electric_instance_id: electric_instance_id, tenant_id: tenant_id}
  end

  @impl Electric.ShapeCache.Storage
  def for_shape(shape_handle, _tenant_id, %FS{shape_handle: shape_handle} = opts) do
    opts
  end

  def for_shape(
        shape_handle,
        tenant_id,
        %{base_path: base_path, electric_instance_id: electric_instance_id} = opts
      ) do
    %FS{
      base_path: base_path,
      shape_handle: shape_handle,
      db: name(electric_instance_id, tenant_id, shape_handle),
      cubdb_dir: Path.join([base_path, tenant_id, shape_handle, "cubdb"]),
      snapshot_dir: Path.join([base_path, tenant_id, shape_handle, "snapshots"]),
      shape_definition_dir: Path.join([base_path, tenant_id, shape_handle]),
      electric_instance_id: electric_instance_id,
      tenant_id: tenant_id,
      extra_opts: Map.get(opts, :extra_opts, %{})
    }
  end

  defp name(electric_instance_id, tenant_id, shape_handle) do
    Electric.Application.process_name(electric_instance_id, tenant_id, __MODULE__, shape_handle)
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
      CubDB.start_link(data_dir: dir, name: db)
    end
  end

  defp initialise_filesystem(opts) do
    with :ok <- File.mkdir_p(opts.shape_definition_dir),
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
      cleanup!(opts)
    end

    CubDB.put(opts.db, @version_key, @version)
  end

  @impl Electric.ShapeCache.Storage
  def set_shape_definition(shape, %FS{} = opts) do
    file_path = shape_definition_path(opts)
    encoded_shape = Jason.encode!(shape)

    case File.write(file_path, encoded_shape, [:exclusive]) do
      :ok ->
        :ok

      {:error, :eexist} ->
        # file already exists - by virtue of the shape ID being the hash of the
        # definition we do not need to compare them
        :ok

      {:error, reason} ->
        raise "Failed to write shape definition to file: #{reason}"
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shapes(opts) do
    shapes_dir = Path.join([opts.base_path, opts.tenant_id])

    case File.ls(shapes_dir) do
      {:ok, shape_handles} ->
        Enum.reduce(shape_handles, %{}, fn shape_handle, acc ->
          shape_def_path =
            shape_definition_path(%{
              shape_definition_dir: Path.join([opts.base_path, opts.tenant_id, shape_handle])
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
  def get_current_position(%FS{} = opts) do
    {:ok, latest_offset(opts), snapshot_xmin(opts)}
  end

  defp latest_offset(opts) do
    case CubDB.select(opts.db,
           min_key: log_start(),
           max_key: log_end(),
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
  def make_new_snapshot!(data_stream, %FS{} = opts) do
    OpenTelemetry.with_span(
      "storage.make_new_snapshot",
      [storage_impl: "mixed_disk", "shape.handle": opts.shape_handle],
      fn ->
        data_stream
        |> Stream.map(&[&1, ?\n])
        # Use the 4 byte marker (ASCII "end of transmission") to indicate the end of the snapshot,
        # so that concurrent readers can detect that the snapshot has been completed.
        |> Stream.concat([<<4::utf8>>])
        |> Stream.into(File.stream!(shape_snapshot_path(opts), [:append, :delayed_write]))
        |> Stream.run()

        CubDB.put(opts.db, @snapshot_meta_key, LogOffset.first())
      end
    )
  end

  @impl Electric.ShapeCache.Storage
  def get_snapshot(%FS{} = opts) do
    if snapshot_started?(opts) do
      {LogOffset.first(),
       Stream.resource(
         fn -> {open_snapshot_file(opts), nil} end,
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
       )}
    else
      raise "Snapshot no longer available"
    end
  end

  defp open_snapshot_file(opts, attempts_left \\ 100)
  defp open_snapshot_file(_, 0), do: raise(IO.StreamError, reason: :enoent)

  defp open_snapshot_file(opts, attempts_left) do
    case File.open(shape_snapshot_path(opts), [:read, :raw, read_ahead: 1024]) do
      {:ok, file} ->
        file

      {:error, :enoent} ->
        Process.sleep(10)
        open_snapshot_file(opts, attempts_left - 1)

      {:error, reason} ->
        raise IO.StreamError, reason: reason
    end
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
  def get_log_stream(offset, max_offset, %FS{} = opts) do
    opts.db
    |> CubDB.select(
      min_key: log_key(offset),
      max_key: log_key(max_offset),
      min_key_inclusive: false
    )
    |> Stream.map(fn {_, item} -> item end)
  end

  @impl Electric.ShapeCache.Storage
  def get_chunk_end_log_offset(offset, %FS{} = opts) do
    CubDB.select(opts.db,
      min_key: chunk_checkpoint_key(offset),
      max_key: chunk_checkpoint_end(),
      min_key_inclusive: false
    )
    |> Stream.map(fn {key, _} -> offset(key) end)
    |> Enum.take(1)
    |> Enum.at(0)
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%FS{} = opts) do
    [
      @snapshot_meta_key,
      @xmin_key,
      @snapshot_started_key
    ]
    |> Enum.concat(keys_from_range(log_start(), log_end(), opts))
    |> Enum.concat(keys_from_range(chunk_checkpoint_start(), chunk_checkpoint_end(), opts))
    |> then(&CubDB.delete_multi(opts.db, &1))

    {:ok, _} = File.rm_rf(shape_snapshot_path(opts))

    {:ok, _} = File.rm_rf(shape_definition_path(opts))

    :ok
  end

  defp shape_definition_path(%{shape_definition_dir: shape_definition_dir} = _opts) do
    Path.join(shape_definition_dir, @shape_definition_file_name)
  end

  defp keys_from_range(min_key, max_key, opts) do
    CubDB.select(opts.db, min_key: min_key, max_key: max_key)
    |> Stream.map(&elem(&1, 0))
  end

  defp shape_snapshot_path(opts) do
    Path.join([opts.snapshot_dir, "snapshot.jsonl"])
  end

  defp stored_version(opts) do
    CubDB.get(opts.db, @version_key)
  end

  # Key helpers
  defp log_key(offset), do: {:log, LogOffset.to_tuple(offset)}
  defp log_start, do: log_key(LogOffset.first())
  defp log_end, do: log_key(LogOffset.last())

  defp chunk_checkpoint_key(offset), do: {:chunk, LogOffset.to_tuple(offset)}
  defp chunk_checkpoint_start(), do: chunk_checkpoint_key(LogOffset.first())
  defp chunk_checkpoint_end(), do: chunk_checkpoint_key(LogOffset.last())
end
