defmodule Electric.Replication.WalBuffer do
  @moduledoc """
  Durable ring buffer between the ReplicationClient and ShapeLogCollector.

  Owns a `DiskRingBuf` resource and exposes a simple push/peek/commit API.
  The buffer itself is passive — it does not push data downstream.

  - **Producer (ReplicationClient):** calls `push_event/2` to persist WAL
    events. Postgres is acked immediately after the push, so events in this
    buffer must survive restarts.
  - **Consumer (ShapeLogCollector):** calls `peek/1` and `commit/1` to pull
    events when ready.

  The DiskRingBuf is SPSC (single-producer, single-consumer) and uses
  CPU-level atomics, so push and peek/commit can be called from different
  processes without going through the GenServer mailbox.
  """

  use GenServer

  require Logger

  alias Electric.Nifs.DiskRingBuf

  @default_capacity 64 * 1024 * 1024

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Push a WAL event into the ring buffer.

  Called by the ReplicationClient via the `handle_event` MFA.
  Serializes the event and persists it in the ring buffer. Blocks if the
  buffer is full (backpressure to Postgres).

  After a successful push, notifies the ShapeLogCollector that data is
  available for pulling.
  """
  def push_event(event, stack_id) do
    buf = get_buffer(stack_id)
    data = :erlang.term_to_binary(event)

    case DiskRingBuf.push(buf, data) do
      {:ok, seq} ->
        Logger.debug(fn -> "WalBuffer pushed event seq=#{seq} (#{byte_size(data)} bytes)" end)
        Electric.Replication.ShapeLogCollector.wal_data_available(stack_id)
        :ok

      {:error, reason} ->
        Logger.debug(fn -> "WalBuffer push failed: #{inspect(reason)}" end)
        {:error, reason}
    end
  end

  @doc """
  Peek at the next event without removing it from the buffer.

  Returns `{:ok, event}`, `:empty`, or `{:error, reason}`.
  """
  def peek(stack_id) do
    buf = get_buffer(stack_id)

    case DiskRingBuf.peek(buf) do
      {:ok, data} -> {:ok, :erlang.binary_to_term(data)}
      :empty -> :empty
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Commit (remove) the last peeked event from the buffer.

  Only call after `peek/1` returned `{:ok, _}` and the event has been
  successfully processed downstream.
  """
  def commit(stack_id) do
    buf = get_buffer(stack_id)
    DiskRingBuf.commit(buf)
  end

  @doc "Number of events currently in the buffer."
  def len(stack_id) do
    buf = get_buffer(stack_id)
    DiskRingBuf.len(buf)
  end

  @doc "Whether the buffer is empty."
  def is_empty(stack_id) do
    buf = get_buffer(stack_id)
    DiskRingBuf.is_empty(buf)
  end

  @doc "Returns a stats map for the debug endpoint."
  def stats(stack_id) do
    buf = get_buffer(stack_id)
    %{
      entries: DiskRingBuf.len(buf),
      capacity_bytes: DiskRingBuf.capacity(buf),
      full: DiskRingBuf.is_full(buf)
    }
  rescue
    ArgumentError -> %{entries: 0, capacity_bytes: 0, full: false, error: "not_started"}
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  @impl GenServer
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    data_dir = Keyword.fetch!(opts, :data_dir)
    capacity = Keyword.get(opts, :wal_buffer_capacity, @default_capacity)

    Process.set_label({:wal_buffer, stack_id})
    Logger.metadata(stack_id: stack_id)

    buffer_path = Path.join(data_dir, "wal_buffer.ring")
    File.mkdir_p!(Path.dirname(buffer_path))

    {:ok, buf} = DiskRingBuf.open(buffer_path, capacity)

    pending = DiskRingBuf.len(buf)

    if pending > 0 do
      Logger.info("WalBuffer opened with #{pending} persisted events from previous session")
    end

    # Store the buffer reference in ETS so push/peek/commit can bypass
    # the GenServer mailbox (the NIF is SPSC-safe via atomics).
    :persistent_term.put({__MODULE__, stack_id}, buf)

    {:ok, %{stack_id: stack_id, buffer: buf}}
  end

  @impl GenServer
  def terminate(_reason, state) do
    :persistent_term.erase({__MODULE__, state.stack_id})
    DiskRingBuf.close(state.buffer)
  end

  defp get_buffer(stack_id) do
    :persistent_term.get({__MODULE__, stack_id})
  end
end
