defmodule Electric.ShapeCache.LmdbQueueStorage do
  @moduledoc """
  Storage behaviour implementation backed by per-shape LMDB queues.

  Each shape gets a `Electric.QueueSystem.Queue` that manages snapshot + streaming
  data flow into a single output queue. The output queue is also consumed by the
  Distributor/Writer pool for writing to durable streams.

  Keys are 16-byte binaries: `<<lsn::64, offset::64>>` for replication entries
  and `<<0::64, offset::64>>` for snapshot entries.
  """

  @behaviour Electric.ShapeCache.Storage

  alias Electric.Nifs.LmdbNif
  alias Electric.QueueSystem.{Queue, Key}
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage

  require Logger

  @default_map_size :erlang.bsl(4, 30)

  defstruct [
    :base_path,
    :stack_id,
    :shape_handle,
    :chunk_bytes_threshold,
    :map_size,
    read_only?: false
  ]

  # Writer state: wraps the Queue struct plus metadata
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
    map_size = Keyword.get(opts, :map_size, @default_map_size)

    %{
      base_path: Path.join(storage_dir, stack_id),
      stack_id: stack_id,
      chunk_bytes_threshold: chunk_bytes_threshold,
      map_size: map_size
    }
  end

  @impl Storage
  def for_shape(shape_handle, compiled_opts) do
    %__MODULE__{
      base_path: Path.join(compiled_opts.base_path, shape_handle),
      stack_id: compiled_opts.stack_id,
      shape_handle: shape_handle,
      chunk_bytes_threshold: compiled_opts.chunk_bytes_threshold,
      map_size: compiled_opts[:map_size] || @default_map_size
    }
  end

  @impl Storage
  def stack_start_link(_compiled_opts) do
    :ignore
  end

  @impl Storage
  def start_link(_shape_opts) do
    :ignore
  end

  @impl Storage
  def init_writer!(%__MODULE__{} = opts, _shape) do
    queue_dir = Path.join(opts.base_path, "queue")
    File.mkdir_p!(queue_dir)
    Logger.debug("LmdbQueueStorage creating queue at #{queue_dir}")

    queue = Queue.new(queue_dir, map_size: opts.map_size)

    # Try to recover latest offset from output DB
    latest_offset = recover_latest_offset(queue)

    # Check if snapshot metadata exists
    snapshot_started? = File.exists?(Path.join(opts.base_path, "snapshot_started"))

    %WriterState{
      queue: queue,
      opts: opts,
      latest_offset: latest_offset,
      snapshot_started?: snapshot_started?,
      pg_snapshot: nil
    }
  end

  @impl Storage
  def append_to_log!(log_items, %WriterState{} = state) do
    keyed_entries = Enum.map(log_items, &log_item_to_entry/1)
    queue = Queue.write_keyed(state.queue, keyed_entries)

    latest_offset =
      case keyed_entries do
        [] ->
          state.latest_offset

        _ ->
          log_items |> List.last() |> elem(0)
      end

    # Send flushed notification to self (Consumer expects this)
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
  def signal_txn_commit!(_xid, %WriterState{} = state) do
    state
  end

  @impl Storage
  def make_new_snapshot!(data_stream, %__MODULE__{} = opts) do
    snapshot_dir = Path.join([opts.base_path, "queue", "snapshot"])
    File.mkdir_p!(snapshot_dir)

    # Open a direct handle to snapshot_db (separate from the Consumer's Queue)
    db = LmdbNif.open(snapshot_dir, opts.map_size, 1)
    seq = write_snapshot_entries(db, data_stream, 0)

    Logger.debug("Wrote #{seq} snapshot entries to #{snapshot_dir}")

    :ok
  end

  defp write_snapshot_entries(db, stream, seq) do
    Enum.reduce(stream, seq, fn item, acc ->
      # Skip :chunk_boundary markers from the snapshot stream
      if item == :chunk_boundary do
        acc
      else
        value =
          case item do
            iodata when is_list(iodata) -> IO.iodata_to_binary(iodata)
            binary when is_binary(binary) -> binary
          end

        key = Key.snapshot_key(acc)
        :ok = LmdbNif.put(db, key, value)
        acc + 1
      end
    end)
  end

  @doc """
  Perform the queue state transition after snapshot data has been written.

  Called by the Consumer process after receiving notification that snapshot
  data is fully written to snapshot_db. This copies the snapshot and streaming
  data into the output queue in the correct order.

  The transition follows the 4-state pattern from QueueSystem:
  1. Copy snapshot_db → output_db
  2. start_buffering (captures streaming boundary, buffers new writes)
  3. Copy streaming_db (up to boundary) → output_db
  4. go_live (flush buffer, switch to direct output writes)
  """
  def transition_to_live(%WriterState{} = state) do
    queue = state.queue

    # Step 1: Copy all snapshot entries to output
    {:ok, snap_count} = Electric.QueueSystem.Copier.copy(queue.snapshot_db, queue.output_db)
    Logger.debug("Copied #{snap_count} snapshot entries to output")

    # Step 2: Capture the streaming boundary and switch to buffering
    {queue, last_key} = Queue.start_buffering(queue)

    # Step 3: Copy streaming entries up to the boundary
    if last_key do
      {:ok, stream_count} =
        Electric.QueueSystem.Copier.copy_until(queue.streaming_db, queue.output_db, last_key)

      Logger.debug("Copied #{stream_count} streaming entries to output")
    end

    # Step 4: Flush buffer and go live
    queue = Queue.go_live(queue)

    # Clean up temporary DBs
    queue = Queue.cleanup_temp(queue)

    Logger.debug("Queue transitioned to live mode")

    %{state | queue: queue}
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
  def fetch_latest_offset(%__MODULE__{} = opts) do
    queue_dir = Path.join(opts.base_path, "queue")

    if File.exists?(Path.join(queue_dir, "output")) do
      db = LmdbNif.open(Path.join(queue_dir, "output"), @default_map_size, 1)

      case LmdbNif.size(db) do
        0 ->
          {:ok, LogOffset.last_before_real_offsets()}

        _n ->
          # Get the last key to determine the latest offset
          case LmdbNif.iterate_from(db, <<0>>, 0) do
            {:ok, entries} when entries != [] ->
              {last_key, _} = List.last(entries)
              {:ok, key_to_log_offset(last_key)}

            _ ->
              {:ok, LogOffset.last_before_real_offsets()}
          end
      end
    else
      {:ok, LogOffset.last_before_real_offsets()}
    end
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
        base
        |> File.ls!()
        |> Enum.filter(&File.dir?(Path.join(base, &1)))
        |> MapSet.new()

      {:ok, handles}
    else
      {:ok, MapSet.new()}
    end
  end

  @impl Storage
  def get_total_disk_usage(_compiled_opts) do
    0
  end

  @impl Storage
  def get_log_stream(offset, max_offset, %__MODULE__{} = opts) do
    queue_dir = Path.join(opts.base_path, "queue")

    if File.exists?(Path.join(queue_dir, "output")) do
      db = LmdbNif.open(Path.join(queue_dir, "output"), @default_map_size, 1)
      start_key = log_offset_to_key(offset)
      end_key = log_offset_to_key(max_offset)

      case LmdbNif.iterate_range(db, start_key, end_key, 0) do
        {:ok, entries} ->
          Stream.map(entries, fn {_key, value} -> value end)

        {:error, _} ->
          Stream.map([], & &1)
      end
    else
      Stream.map([], & &1)
    end
  end

  @impl Storage
  def get_chunk_end_log_offset(_offset, _opts) do
    # For LMDB queue storage, we don't track chunks — all data is in one queue
    LogOffset.last()
  end

  @impl Storage
  def terminate(%WriterState{} = _state) do
    :ok
  end

  @impl Storage
  def hibernate(%WriterState{} = state) do
    state
  end

  @impl Storage
  def cleanup!(%__MODULE__{} = opts) do
    if File.exists?(opts.base_path) do
      File.rm_rf!(opts.base_path)
    end

    :ok
  end

  @impl Storage
  def cleanup!(compiled_opts, shape_handle) do
    path = Path.join(compiled_opts.base_path, shape_handle)

    if File.exists?(path) do
      File.rm_rf!(path)
    end

    :ok
  end

  @impl Storage
  def cleanup_all!(compiled_opts) do
    if File.exists?(compiled_opts.base_path) do
      File.rm_rf!(compiled_opts.base_path)
    end

    :ok
  end

  @impl Storage
  def supports_txn_fragment_streaming?() do
    true
  end

  @impl Storage
  def compact(_opts, _keep_complete_chunks) do
    # No-op for LMDB queue storage — compaction is handled by drain/ack
    :ok
  end

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
    # Control messages get a synthetic offset
    offset = LogOffset.increment(state.latest_offset || LogOffset.last_before_real_offsets())
    json = if is_binary(message), do: message, else: Jason.encode!(message)
    key = log_offset_to_key(offset)

    queue = Queue.write_keyed(state.queue, [{key, json}])
    state = %{state | queue: queue, latest_offset: offset}

    send(self(), {Storage, :flushed, offset})

    {{offset, offset}, state}
  end

  # ============================================================================
  # Internal helpers
  # ============================================================================

  defp log_item_to_entry({%LogOffset{} = offset, _key, _op_type, json}) do
    lmdb_key = log_offset_to_key(offset)

    value =
      case json do
        iodata when is_list(iodata) -> IO.iodata_to_binary(iodata)
        binary when is_binary(binary) -> binary
      end

    {lmdb_key, value}
  end

  defp log_offset_to_key(%LogOffset{tx_offset: tx, op_offset: :infinity}) do
    Key.key(tx, 0xFFFFFFFFFFFFFFFF)
  end

  defp log_offset_to_key(%LogOffset{tx_offset: tx, op_offset: op}) do
    Key.key(tx, op)
  end

  defp log_offset_to_key({tx, :infinity}) do
    Key.key(tx, 0xFFFFFFFFFFFFFFFF)
  end

  defp log_offset_to_key({tx, op}) do
    Key.key(tx, op)
  end

  defp key_to_log_offset(<<lsn::unsigned-big-integer-size(64), offset::unsigned-big-integer-size(64)>>) do
    LogOffset.new(lsn, offset)
  end

  defp recover_latest_offset(%Queue{} = queue) do
    db = Queue.output_db(queue)

    case LmdbNif.size(db) do
      0 ->
        nil

      _n ->
        # Scan to find the last key
        case LmdbNif.iterate_from(db, <<0>>, 0) do
          {:ok, entries} when entries != [] ->
            {last_key, _} = List.last(entries)
            key_to_log_offset(last_key)

          _ ->
            nil
        end
    end
  end
end
