defmodule Electric.ShapeCache.LmdbQueueStorage do
  @moduledoc """
  Storage behaviour implementation backed by per-shape DiskQueues.

  Each shape gets a `Electric.QueueSystem.Queue` that manages snapshot + streaming
  data flow into a single output queue. The output queue is consumed by the
  Distributor/Writer pool for writing to durable streams.

  Values are stored as-is (JSON strings). The DiskQueue assigns monotonic
  integer IDs automatically — no explicit key management needed.
  """

  @behaviour Electric.ShapeCache.Storage

  alias Electric.Nifs.DiskQueue
  alias Electric.QueueSystem.Queue
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage

  require Logger

  defstruct [
    :base_path,
    :stack_id,
    :shape_handle,
    :chunk_bytes_threshold,
    read_only?: false
  ]

  defmodule WriterState do
    @moduledoc false
    defstruct [
      :queue,
      :opts,
      :latest_offset,
      :snapshot_started?,
      :pg_snapshot
    ]
  end

  # ============================================================================
  # Storage behaviour callbacks
  # ============================================================================

  @impl Storage
  def shared_opts(opts) when is_list(opts) do
    storage_dir = Keyword.fetch!(opts, :storage_dir)
    stack_id = Keyword.fetch!(opts, :stack_id)
    chunk_bytes_threshold = Keyword.get(opts, :chunk_bytes_threshold, 64 * 1024)

    %{
      base_path: Path.join(storage_dir, stack_id),
      stack_id: stack_id,
      chunk_bytes_threshold: chunk_bytes_threshold
    }
  end

  @impl Storage
  def for_shape(shape_handle, compiled_opts) do
    %__MODULE__{
      base_path: shape_path(compiled_opts.base_path, shape_handle),
      stack_id: compiled_opts.stack_id,
      shape_handle: shape_handle,
      chunk_bytes_threshold: compiled_opts.chunk_bytes_threshold
    }
  end

  @doc """
  Returns the on-disk path for a shape's storage:
  `<base>/<bucket>/<shape_handle>`, where bucket is the first 3 characters
  of the shape handle. This avoids having huge numbers of entries in a
  single directory while keeping manual filesystem navigation easy —
  you can go straight to a shape's files knowing only its handle.
  """
  def shape_path(base, shape_handle) do
    bucket = String.slice(shape_handle, 0, 3)
    Path.join([base, bucket, shape_handle])
  end

  @impl Storage
  def stack_start_link(_compiled_opts), do: :ignore

  @impl Storage
  def start_link(_shape_opts), do: :ignore

  @impl Storage
  def init_writer!(%__MODULE__{} = opts, _shape) do
    queue_dir = Path.join(opts.base_path, "queue")
    File.mkdir_p!(queue_dir)
    Logger.debug("Creating DiskQueue at #{queue_dir}")

    queue = Queue.new(queue_dir)

    snapshot_started? = File.exists?(Path.join(opts.base_path, "snapshot_started"))

    %WriterState{
      queue: queue,
      opts: opts,
      latest_offset: nil,
      snapshot_started?: snapshot_started?,
      pg_snapshot: nil
    }
  end

  @impl Storage
  def append_to_log!(log_items, %WriterState{} = state) do
    values = Enum.map(log_items, &log_item_to_value/1)
    queue = Enum.reduce(values, state.queue, fn value, q -> Queue.push(q, value) end)

    latest_offset =
      case log_items do
        [] -> state.latest_offset
        _ -> log_items |> List.last() |> elem(0)
      end

    if latest_offset do
      send(self(), {Storage, :flushed, latest_offset})
    end

    %{state | queue: queue, latest_offset: latest_offset}
  end

  @impl Storage
  def append_fragment_to_log!(log_items, %WriterState{} = state) do
    append_to_log!(log_items, state)
  end

  @impl Storage
  def signal_txn_commit!(_xid, %WriterState{} = state), do: state

  @impl Storage
  def make_new_snapshot!(data_stream, %__MODULE__{} = opts) do
    output_dir = Path.join([opts.base_path, "queue", "output"])
    File.mkdir_p!(output_dir)

    {:ok, q} = DiskQueue.open(output_dir)
    count = write_snapshot_entries(q, data_stream, 0)

    Logger.debug("Wrote #{count} snapshot entries to #{output_dir}")
    :ok
  end

  defp write_snapshot_entries(q, stream, count) do
    Enum.reduce(stream, count, fn item, acc ->
      if item == :chunk_boundary do
        acc
      else
        value =
          case item do
            iodata when is_list(iodata) -> IO.iodata_to_binary(iodata)
            binary when is_binary(binary) -> binary
          end

        {:ok, _seq} = DiskQueue.push(q, value)
        acc + 1
      end
    end)
  end

  @doc """
  Copy the streaming buffer into the output queue. Called from the snapshotter
  task after the snapshot has been written and the consumer has been flipped
  into `:buffering` mode.

  Opens fresh handles on `<base>/queue/streaming/` and `<base>/queue/output/`
  for the duration of the copy; they are dropped when this function returns.

  Returns the number of records copied.
  """
  def copy_buffer_to_output!(%__MODULE__{} = opts, last_id) do
    queue_dir = Path.join(opts.base_path, "queue")
    {:ok, src} = DiskQueue.open(Path.join(queue_dir, "streaming"))
    {:ok, dst} = DiskQueue.open(Path.join(queue_dir, "output"))

    {:ok, count} = Queue.copy_streaming_to_output(src, dst, last_id)

    if count > 0, do: Logger.debug("Copied #{count} streaming entries to output")
    count
  end

  @impl Storage
  def snapshot_started?(%__MODULE__{} = opts) do
    File.exists?(Path.join(opts.base_path, "snapshot_started"))
  end

  @impl Storage
  def mark_snapshot_as_started(%__MODULE__{} = opts) do
    File.mkdir_p!(opts.base_path)
    File.write!(Path.join(opts.base_path, "snapshot_started"), "")
    :ok
  end

  @impl Storage
  def fetch_latest_offset(%__MODULE__{} = _opts) do
    # DiskQueue doesn't support random access — return a default.
    # The read path uses durable streams, not local storage.
    {:ok, LogOffset.last_before_real_offsets()}
  end

  @impl Storage
  def fetch_pg_snapshot(%__MODULE__{} = opts) do
    path = Path.join(opts.base_path, "pg_snapshot")

    case File.read(path) do
      {:ok, data} -> {:ok, :erlang.binary_to_term(data)}
      {:error, :enoent} -> {:ok, nil}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl Storage
  def set_pg_snapshot(pg_snapshot, %__MODULE__{} = opts) do
    File.mkdir_p!(opts.base_path)
    File.write!(Path.join(opts.base_path, "pg_snapshot"), :erlang.term_to_binary(pg_snapshot))
    :ok
  end

  @impl Storage
  def get_all_stored_shape_handles(compiled_opts) do
    base = compiled_opts.base_path

    if File.exists?(base) do
      handles =
        for bucket <- File.ls!(base),
            bucket_path = Path.join(base, bucket),
            File.dir?(bucket_path),
            shape_handle <- File.ls!(bucket_path),
            File.dir?(Path.join(bucket_path, shape_handle)),
            into: MapSet.new(),
            do: shape_handle

      {:ok, handles}
    else
      {:ok, MapSet.new()}
    end
  end

  @impl Storage
  def get_total_disk_usage(_compiled_opts), do: 0

  @impl Storage
  def get_log_stream(_offset, _max_offset, %__MODULE__{} = _opts) do
    # Read path is served from durable streams, not local storage.
    Stream.map([], & &1)
  end

  @impl Storage
  def get_chunk_end_log_offset(_offset, _opts), do: LogOffset.last()

  @impl Storage
  def terminate(%WriterState{} = _state), do: :ok

  @impl Storage
  def hibernate(%WriterState{} = state), do: state

  @impl Storage
  def cleanup!(%__MODULE__{} = opts) do
    if File.exists?(opts.base_path), do: File.rm_rf!(opts.base_path)
    :ok
  end

  @impl Storage
  def cleanup!(compiled_opts, shape_handle) do
    path = shape_path(compiled_opts.base_path, shape_handle)
    if File.exists?(path), do: File.rm_rf!(path)
    :ok
  end

  @impl Storage
  def cleanup_all!(compiled_opts) do
    if File.exists?(compiled_opts.base_path), do: File.rm_rf!(compiled_opts.base_path)
    :ok
  end

  @impl Storage
  def supports_txn_fragment_streaming?(), do: true

  @impl Storage
  def compact(_opts, _keep_complete_chunks), do: :ok

  @impl Storage
  def write_move_in_snapshot!(_data_stream, _name, _opts) do
    raise "write_move_in_snapshot! not yet supported for LmdbQueueStorage"
  end

  @impl Storage
  def append_move_in_snapshot_to_log!(_name, _writer_state, _skip_row?) do
    raise "append_move_in_snapshot_to_log! not yet supported for LmdbQueueStorage"
  end

  @impl Storage
  def append_control_message!(message, %WriterState{} = state) do
    offset = LogOffset.increment(state.latest_offset || LogOffset.last_before_real_offsets())
    json = if is_binary(message), do: message, else: Jason.encode!(message)

    queue = Queue.push(state.queue, json)
    state = %{state | queue: queue, latest_offset: offset}

    send(self(), {Storage, :flushed, offset})
    {{offset, offset}, state}
  end

  # ============================================================================
  # Internal helpers
  # ============================================================================

  defp log_item_to_value({%LogOffset{}, _key, _op_type, json}) do
    case json do
      iodata when is_list(iodata) -> IO.iodata_to_binary(iodata)
      binary when is_binary(binary) -> binary
    end
  end
end
