defmodule Electric.DurableStreams.Distributor do
  @moduledoc """
  Routes shape write notifications to a pool of HTTP writer processes
  using consistent hashing.

  When a Consumer writes to its LMDB queue, it calls
  `Distributor.notify_writes/2` which forwards the notification to
  the writer process assigned to that shape via consistent hashing.

  The consistent hashing ensures the same writer always handles the
  same shape, preserving write ordering.
  """

  use GenServer

  require Logger

  alias Electric.DurableStreams.Writer

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Notify the distributor that a shape has new data in its queue.

  No-op if the distributor is not running (durable streams not configured).
  """
  def notify_writes(stack_id, shape_handle) do
    case GenServer.whereis(name(stack_id)) do
      nil -> :ok
      pid -> GenServer.cast(pid, {:notify_writes, shape_handle})
    end
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  @impl GenServer
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    num_writers = Keyword.get(opts, :num_writers, 4)

    Process.set_label({:distributor, stack_id})
    Logger.metadata(stack_id: stack_id)

    state = %{
      stack_id: stack_id,
      num_writers: num_writers,
      writer_pids: %{}
    }

    {:ok, state}
  end

  @impl GenServer
  def handle_cast({:notify_writes, shape_handle}, state) do
    writer_index = :erlang.phash2(shape_handle, state.num_writers)
    Logger.debug(fn -> "Distributor routing #{shape_handle} -> writer #{writer_index}" end)

    case Map.get(state.writer_pids, writer_index) do
      nil ->
        Logger.debug("Writer #{writer_index} not registered, dropping notification for #{shape_handle}")
        {:noreply, state}

      pid when is_pid(pid) ->
        Writer.process_shape(pid, shape_handle)
        {:noreply, state}
    end
  end

  @impl GenServer
  def handle_cast({:register_writer, index, pid}, state) do
    state = %{state | writer_pids: Map.put(state.writer_pids, index, pid)}
    {:noreply, state}
  end

  @doc """
  Register a writer process with the distributor.
  """
  def register_writer(stack_id, index, pid) do
    GenServer.cast(name(stack_id), {:register_writer, index, pid})
  end
end
