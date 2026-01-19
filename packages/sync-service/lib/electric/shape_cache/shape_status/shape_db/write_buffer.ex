defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBuffer do
  @moduledoc """
  Buffers SQLite metadata writes using ETS for immediate return to callers,
  then batches and flushes to SQLite in the background.

  This prevents timeout cascades when many concurrent clients create shapes
  after a redeploy.

  ## How it works

  1. Callers insert entries into the ETS table with `flushing: false`
  2. A GenServer polls every 50ms and flushes pending entries
  3. Before SQLite write, entries are marked `flushing: true`
  4. After SQLite write, entries with `flushing: true` are deleted
  5. New entries that arrive during flush have `flushing: false` - they won't be deleted

  ## Entry format

  All entries have the format: `{key, data, flushing}` where data includes a
  monotonic timestamp to preserve insertion order during flush.

  - `:add` entries: `{{:add, handle}, {timestamp, shape_binary, comparable, hash, relations}, false}`
  - `:remove` entries: `{{:remove, handle}, {timestamp}, false}`
  - `:snapshot_started` entries: `{{:snapshot_started, handle}, {timestamp}, false}`
  - `:snapshot_complete` entries: `{{:snapshot_complete, handle}, {timestamp}, false}`
  """

  use GenServer

  require Logger

  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Query
  alias Electric.Telemetry.OpenTelemetry

  import Electric, only: [is_stack_id: 1]

  @poll_interval 50
  @max_drain_per_cycle 1000

  def pending_table_name(stack_id), do: :"pending_writes:#{stack_id}"

  def name(stack_id), do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  @doc "Returns a monotonic timestamp for ordering writes"
  def timestamp, do: System.monotonic_time()

  def start_link(args) do
    stack_id = Keyword.fetch!(args, :stack_id)
    GenServer.start_link(__MODULE__, args, name: name(stack_id))
  end

  @doc """
  Synchronously flush all pending writes. Useful for testing and graceful shutdown.
  """
  def flush_sync(stack_id, timeout \\ 5000) when is_stack_id(stack_id) do
    GenServer.call(name(stack_id), :flush_sync, timeout)
  end

  @impl GenServer
  def init(opts) do
    Process.flag(:trap_exit, true)

    stack_id = Keyword.fetch!(opts, :stack_id)
    manual_flush_only = Keyword.get(opts, :manual_flush_only, false)
    table = pending_table_name(stack_id)

    Process.set_label({:shape_db_write_buffer, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ets.new(table, [
      :named_table,
      :public,
      :set,
      write_concurrency: :auto,
      read_concurrency: true
    ])

    unless manual_flush_only, do: schedule_poll()

    {:ok, %{stack_id: stack_id, table: table, manual_flush_only: manual_flush_only}}
  end

  @impl GenServer
  def handle_info(:poll, %{manual_flush_only: false} = state) do
    flush_until_empty(state)
    schedule_poll()
    {:noreply, state}
  end

  @impl GenServer
  def handle_call(:flush_sync, _from, state) do
    flush_until_empty(state)
    {:reply, :ok, state}
  end

  @impl GenServer
  def terminate(_reason, state) do
    flush_until_empty(state)
  end

  defp schedule_poll do
    Process.send_after(self(), :poll, @poll_interval)
  end

  defp flush_until_empty(%{table: table, stack_id: stack_id} = state) do
    entries = mark_and_collect_entries(table, @max_drain_per_cycle)

    if entries != [] do
      OpenTelemetry.with_span(
        "shape_db.write_buffer.flush",
        [entry_count: length(entries)],
        stack_id,
        fn -> do_batch_write(stack_id, entries) end
      )

      Enum.each(entries, fn {key, _data} ->
        :ets.select_delete(table, [{{key, :_, true}, [], [true]}])
      end)

      if length(entries) >= @max_drain_per_cycle do
        flush_until_empty(state)
      end
    end
  end

  defp mark_and_collect_entries(table, limit) do
    match_spec = [{{:"$1", :"$2", false}, [], [{{:"$1", :"$2"}}]}]

    case :ets.select(table, match_spec) do
      [] ->
        []

      results ->
        results
        |> Enum.sort_by(&entry_timestamp/1)
        |> Enum.take(limit)
        |> Enum.map(fn {key, _data} = entry ->
          :ets.update_element(table, key, {3, true})
          entry
        end)
    end
  end

  defp do_batch_write(stack_id, entries) do
    Connection.checkout_write!(stack_id, :batch_write, fn conn ->
      Enum.each(entries, fn
        {{:add, handle}, {_ts, shape_binary, comparable_binary, hash, relations}} ->
          shape = :erlang.binary_to_term(shape_binary)
          comparable_shape = :erlang.binary_to_term(comparable_binary)
          :ok = Query.add_shape(conn, handle, shape, comparable_shape, hash, relations)

        {{:remove, handle}, _data} ->
          Query.remove_shape(conn, handle)

        {{:snapshot_started, handle}, _data} ->
          Query.mark_snapshot_started(conn, handle)

        {{:snapshot_complete, handle}, _data} ->
          Query.mark_snapshot_complete(conn, handle)
      end)

      :ok
    end)
  rescue
    e ->
      Logger.error("WriteBuffer batch write failed: #{inspect(e)}")
      :error
  end

  defp entry_timestamp({{:add, _}, {ts, _, _, _, _}}), do: ts
  defp entry_timestamp({_, {ts}}), do: ts
end
