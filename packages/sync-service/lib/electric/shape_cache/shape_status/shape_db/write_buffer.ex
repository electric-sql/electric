defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBuffer do
  @moduledoc """
  Buffers SQLite metadata writes using ETS for immediate return to callers,
  then batches and flushes to SQLite in the background.

  This prevents timeout cascades when many concurrent clients create shapes
  after a redeploy.

  ## Architecture

  Two ETS tables are used:

  1. **Operations table** - ordered queue of operations to flush to SQLite
  2. **Shapes table** - current logical state for fast lookups

  ## How it works

  1. When a shape is added/removed, update the shapes table immediately
  2. Queue the operation in the operations table for SQLite persistence
  3. GenServer polls every 50ms and flushes pending operations to SQLite
  4. Lookups read from the shapes table (fast, no complex pattern matching)

  ## Operations table format

  `{timestamp, operation, flushing}`

  - `:add` operation: `{ts, {:add, handle, shape_binary, comparable, hash, relations}, false}`
  - `:remove` operation: `{ts, {:remove, handle}, false}`
  - `:snapshot_started` operation: `{ts, {:snapshot_started, handle}, false}`
  - `:snapshot_complete` operation: `{ts, {:snapshot_complete, handle}, false}`

  ## Shapes table format

  `{handle, shape_binary, comparable_binary, hash, relations, snapshot_started, snapshot_complete}`
  """

  use GenServer

  require Logger

  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Query
  alias Electric.Telemetry.OpenTelemetry

  import Electric, only: [is_stack_id: 1]

  @poll_interval 50
  @max_drain_per_cycle 1000

  def operations_table_name(stack_id), do: :"write_buffer_ops:#{stack_id}"
  def shapes_table_name(stack_id), do: :"write_buffer_shapes:#{stack_id}"

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

  # Lookup functions for the shapes table

  @doc "Look up a shape by its handle"
  def lookup_shape(stack_id, handle) do
    table = shapes_table_name(stack_id)

    case :ets.lookup(table, handle) do
      [{^handle, shape_binary, _comparable, _hash, _relations, _started, _complete}] ->
        {:ok, :erlang.binary_to_term(shape_binary)}

      [] ->
        :not_found
    end
  end

  @doc "Look up a handle by comparable shape binary"
  def lookup_handle(stack_id, comparable_binary) do
    table = shapes_table_name(stack_id)
    pattern = {:_, :_, comparable_binary, :_, :_, :_, :_}

    case :ets.match_object(table, pattern) do
      [{handle, _shape, _comparable, _hash, _relations, _started, _complete} | _] ->
        {:ok, handle}

      [] ->
        :not_found
    end
  end

  @doc "Look up a shape's hash by its handle"
  def lookup_hash(stack_id, handle) do
    table = shapes_table_name(stack_id)

    case :ets.lookup(table, handle) do
      [{^handle, _shape, _comparable, hash, _relations, _started, _complete}] ->
        {:ok, hash}

      [] ->
        :not_found
    end
  end

  @doc "Check if a handle exists in the shapes table"
  def handle_exists?(stack_id, handle) do
    :ets.member(shapes_table_name(stack_id), handle)
  end

  @doc "Check if snapshot_started is true for a handle (checks shapes table and pending ops)"
  def snapshot_started?(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)

    case :ets.lookup(shapes_table, handle) do
      [{^handle, _shape, _comparable, _hash, _relations, started, complete}] ->
        # snapshot_complete implies snapshot_started
        {:ok, started or complete}

      [] ->
        # Shape not in buffer - check if there's a pending snapshot operation
        if has_pending_snapshot_started?(stack_id, handle) or
             has_pending_snapshot_complete?(stack_id, handle) do
          {:ok, true}
        else
          :not_found
        end
    end
  end

  @doc "Check if snapshot_complete is true for a handle (checks shapes table and pending ops)"
  def snapshot_complete?(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)

    case :ets.lookup(shapes_table, handle) do
      [{^handle, _shape, _comparable, _hash, _relations, _started, complete}] ->
        {:ok, complete}

      [] ->
        # Shape not in buffer - check if there's a pending snapshot_complete operation
        if has_pending_snapshot_complete?(stack_id, handle) do
          {:ok, true}
        else
          :not_found
        end
    end
  end

  defp has_pending_snapshot_started?(stack_id, handle) do
    ops_table = operations_table_name(stack_id)
    pattern = {:_, {:snapshot_started, handle}, :_}
    :ets.match_object(ops_table, pattern) != []
  end

  defp has_pending_snapshot_complete?(stack_id, handle) do
    ops_table = operations_table_name(stack_id)
    pattern = {:_, {:snapshot_complete, handle}, :_}
    :ets.match_object(ops_table, pattern) != []
  end

  @doc "Get all buffered shapes as {handle, shape} pairs"
  def list_shapes(stack_id) do
    shapes_table_name(stack_id)
    |> :ets.tab2list()
    |> Enum.map(fn {handle, shape_binary, _comparable, _hash, _relations, _started, _complete} ->
      {handle, :erlang.binary_to_term(shape_binary)}
    end)
  end

  @doc "Get buffered handles that match the given relations"
  def handles_for_relations(stack_id, relations) do
    relation_oids = MapSet.new(relations, fn {oid, _relation} -> oid end)

    shapes_table_name(stack_id)
    |> :ets.tab2list()
    |> Enum.filter(fn {_handle, _shape, _comparable, _hash, entry_relations, _started, _complete} ->
      Enum.any?(entry_relations, fn {oid, _} -> MapSet.member?(relation_oids, oid) end)
    end)
    |> Enum.map(fn {handle, _, _, _, _, _, _} -> handle end)
  end

  @doc "Get buffered shape metadata as {handle, hash, snapshot_started} tuples"
  def list_shape_meta(stack_id) do
    shapes_table_name(stack_id)
    |> :ets.tab2list()
    |> Enum.map(fn {handle, _shape, _comparable, hash, _relations, started, complete} ->
      # snapshot_complete implies snapshot_started
      {handle, hash, started or complete}
    end)
  end

  @doc "Returns the number of pending operations in the buffer"
  def pending_operations_count(stack_id) do
    :ets.info(operations_table_name(stack_id), :size)
  end

  @doc "Returns handles with pending remove operations (not yet flushed to SQLite)"
  def pending_removes(stack_id) do
    ops_table = operations_table_name(stack_id)
    pattern = {:_, {:remove, :_}, :_}

    ops_table
    |> :ets.match_object(pattern)
    |> Enum.map(fn {_ts, {:remove, handle}, _flushing} -> handle end)
    |> MapSet.new()
  end

  @doc "Returns handles with pending add operations (not yet flushed to SQLite)"
  def pending_adds(stack_id) do
    ops_table = operations_table_name(stack_id)
    pattern = {:_, {:add, :_, :_, :_, :_, :_}, :_}

    ops_table
    |> :ets.match_object(pattern)
    |> Enum.map(fn {_ts, {:add, handle, _, _, _, _}, _flushing} -> handle end)
    |> MapSet.new()
  end

  @doc "Returns handles with pending snapshot_started operations (not yet flushed to SQLite)"
  def pending_snapshot_started(stack_id) do
    ops_table = operations_table_name(stack_id)

    started_pattern = {:_, {:snapshot_started, :_}, :_}

    started =
      ops_table
      |> :ets.match_object(started_pattern)
      |> Enum.map(fn {_, {:snapshot_started, handle}, _} -> handle end)
      |> MapSet.new()

    # snapshot_complete implies snapshot_started
    complete_pattern = {:_, {:snapshot_complete, :_}, :_}

    complete =
      ops_table
      |> :ets.match_object(complete_pattern)
      |> Enum.map(fn {_, {:snapshot_complete, handle}, _} -> handle end)
      |> MapSet.new()

    MapSet.union(started, complete)
  end

  @doc "Returns the number of shapes in the lookup table"
  def shapes_count(stack_id) do
    :ets.info(shapes_table_name(stack_id), :size)
  end

  # Write functions

  @doc "Add a shape to the buffer"
  def add_shape(stack_id, handle, shape_binary, comparable_binary, hash, relations) do
    shapes_table = shapes_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = timestamp()

    # Add to shapes lookup table (snapshot_started=false, snapshot_complete=false)
    true =
      :ets.insert(
        shapes_table,
        {handle, shape_binary, comparable_binary, hash, relations, false, false}
      )

    # Queue operation for SQLite
    true =
      :ets.insert(
        ops_table,
        {ts, {:add, handle, shape_binary, comparable_binary, hash, relations}, false}
      )

    :ok
  end

  @doc "Remove a shape from the buffer"
  def remove_shape(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = timestamp()

    # Remove from shapes lookup table
    :ets.delete(shapes_table, handle)

    # Queue operation for SQLite
    true = :ets.insert(ops_table, {ts, {:remove, handle}, false})

    :ok
  end

  @doc "Queue a snapshot_started operation and update shapes table"
  def queue_snapshot_started(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = timestamp()

    # Update snapshot_started flag in shapes table (position 6)
    :ets.update_element(shapes_table, handle, {6, true})

    # Queue operation for SQLite
    true = :ets.insert(ops_table, {ts, {:snapshot_started, handle}, false})
    :ok
  end

  @doc "Queue a snapshot_complete operation and update shapes table"
  def queue_snapshot_complete(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = timestamp()

    # Update snapshot_complete flag in shapes table (position 7)
    :ets.update_element(shapes_table, handle, {7, true})

    # Queue operation for SQLite
    true = :ets.insert(ops_table, {ts, {:snapshot_complete, handle}, false})
    :ok
  end

  @doc "Clear all data from both tables"
  def clear(stack_id) do
    :ets.delete_all_objects(shapes_table_name(stack_id))
    :ets.delete_all_objects(operations_table_name(stack_id))
    :ok
  end

  @impl GenServer
  def init(opts) do
    Process.flag(:trap_exit, true)

    stack_id = Keyword.fetch!(opts, :stack_id)
    manual_flush_only = Keyword.get(opts, :manual_flush_only, false)

    Process.set_label({:shape_db_write_buffer, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    ops_table = operations_table_name(stack_id)
    shapes_table = shapes_table_name(stack_id)

    :ets.new(ops_table, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto,
      read_concurrency: true
    ])

    :ets.new(shapes_table, [
      :named_table,
      :public,
      :set,
      write_concurrency: :auto,
      read_concurrency: true
    ])

    unless manual_flush_only, do: schedule_poll()

    {:ok,
     %{
       stack_id: stack_id,
       ops_table: ops_table,
       shapes_table: shapes_table,
       manual_flush_only: manual_flush_only
     }}
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

  defp flush_until_empty(
         %{ops_table: ops_table, shapes_table: shapes_table, stack_id: stack_id} = state
       ) do
    entries = mark_and_collect_entries(ops_table, @max_drain_per_cycle)

    if entries != [] do
      result =
        OpenTelemetry.with_span(
          "shape_db.write_buffer.flush",
          [entry_count: length(entries)],
          stack_id,
          fn -> do_batch_write(stack_id, entries) end
        )

      if result == :ok do
        # Clean up shapes table for flushed :add operations
        Enum.each(entries, fn
          {_ts, {:add, handle, _, _, _, _}} ->
            :ets.delete(shapes_table, handle)

          _ ->
            :ok
        end)

        # Delete flushed entries from ops table
        Enum.each(entries, fn {ts, _op} ->
          :ets.select_delete(ops_table, [{{ts, :_, true}, [], [true]}])
        end)

        if length(entries) >= @max_drain_per_cycle do
          flush_until_empty(state)
        end
      end
    end
  end

  defp mark_and_collect_entries(ops_table, limit) do
    # Select entries with flushing=false
    match_spec = [{{:"$1", :"$2", false}, [], [{{:"$1", :"$2"}}]}]

    case :ets.select(ops_table, match_spec, limit) do
      {results, _continuation} ->
        Enum.map(results, fn {ts, _op} = entry ->
          :ets.update_element(ops_table, ts, {3, true})
          entry
        end)

      :"$end_of_table" ->
        []
    end
  end

  defp do_batch_write(stack_id, entries) do
    Connection.checkout_write!(stack_id, :batch_write, fn conn ->
      Enum.each(entries, fn
        {_ts, {:add, handle, shape_binary, comparable_binary, hash, relations}} ->
          shape = :erlang.binary_to_term(shape_binary)
          comparable_shape = :erlang.binary_to_term(comparable_binary)
          :ok = Query.add_shape(conn, handle, shape, comparable_shape, hash, relations)

        {_ts, {:remove, handle}} ->
          Query.remove_shape(conn, handle)

        {_ts, {:snapshot_started, handle}} ->
          Query.mark_snapshot_started(conn, handle)

        {_ts, {:snapshot_complete, handle}} ->
          Query.mark_snapshot_complete(conn, handle)
      end)

      :ok
    end)
  rescue
    e ->
      Logger.error("WriteBuffer batch write failed: #{inspect(e)}")
      :error
  end
end
