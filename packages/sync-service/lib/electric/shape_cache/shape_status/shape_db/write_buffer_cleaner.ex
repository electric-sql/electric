defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBufferCleaner do
  @moduledoc """
  Periodically cleans up flushed entries from the WriteBuffer ETS table.

  After the WriteBuffer flushes entries to SQLite, it retains them in ETS
  with a `flushed_at` timestamp to cover SQLite's WAL-mode stale-read window.
  This GenServer removes entries that have been retained longer than the
  configured retention period (default 60 seconds).
  """

  use GenServer

  alias Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBuffer

  import Electric, only: [is_stack_id: 1]

  @cleanup_interval_ms 1_000
  @default_flushed_retention_ms 60_000

  def name(stack_id), do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  def start_link(args) do
    stack_id = Keyword.fetch!(args, :stack_id)
    GenServer.start_link(__MODULE__, args, name: name(stack_id))
  end

  @doc """
  Synchronously run cleanup. Useful for testing.
  """
  def cleanup_sync(stack_id) when is_stack_id(stack_id) do
    GenServer.call(name(stack_id), :cleanup_sync)
  end

  @impl GenServer
  def init(args) do
    stack_id = Keyword.fetch!(args, :stack_id)
    flushed_retention_ms = Keyword.get(args, :flushed_retention_ms, @default_flushed_retention_ms)

    Process.set_label({:write_buffer_cleaner, stack_id})

    state = %{
      stack_id: stack_id,
      shapes_table: WriteBuffer.shapes_table_name(stack_id),
      flushed_retention_ms: flushed_retention_ms
    }

    schedule_cleanup()

    {:ok, state}
  end

  @impl GenServer
  def handle_info(:cleanup, state) do
    do_cleanup(state)
    schedule_cleanup()
    {:noreply, state}
  end

  @impl GenServer
  def handle_call(:cleanup_sync, _from, state) do
    {:reply, do_cleanup(state), state}
  end

  defp schedule_cleanup do
    Process.send_after(self(), :cleanup, @cleanup_interval_ms)
  end

  @doc """
  Perform cleanup directly on the ETS table. Useful for testing without
  going through the GenServer.

  Deletes flushed entries older than `cutoff` (a monotonic timestamp).
  """
  def delete_older_than(shapes_table, cutoff) do
    :ets.select_delete(shapes_table, [
      {{{:shape, :_}, :_, :_, :"$1"},
       [{:andalso, {:"/=", :"$1", nil}, {:<, :"$1", cutoff}}],
       [true]},
      {{{:comparable, :_}, :_, :"$1"},
       [{:andalso, {:"/=", :"$1", nil}, {:<, :"$1", cutoff}}],
       [true]}
    ])
  end

  defp do_cleanup(%{shapes_table: shapes_table, flushed_retention_ms: retention_ms}) do
    cutoff = System.monotonic_time() - System.convert_time_unit(retention_ms, :millisecond, :native)
    delete_older_than(shapes_table, cutoff)
    :ok
  end
end
