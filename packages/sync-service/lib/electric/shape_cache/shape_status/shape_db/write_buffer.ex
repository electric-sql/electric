defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBuffer do
  @moduledoc """
  Buffers SQLite metadata writes using ETS for immediate return to callers,
  then batches and flushes to SQLite in the background.

  This prevents timeout cascades when many concurrent clients create shapes
  after a redeploy.

  ## Architecture

  Three ETS tables are used:

  1. **Operations table** - ordered queue of operations to flush to SQLite
  2. **Shapes table** - buffered shapes for fast handle_for_shape/shape_for_handle lookups
  3. **Tombstones table** - handles marked for deletion (cleaned up after flush)

  ## How it works

  1. When a shape is added, insert into shapes table and queue :add operation
  2. When a shape is removed, insert into tombstones table and queue :remove operation
  3. GenServer polls every 50ms and flushes pending operations to SQLite
  4. After successful flush, clean up shapes table (for adds) and tombstones (for removes)

  ## Operations table format

  `{timestamp, operation, flushing}`

  ## Shapes table format

  `{handle, shape_binary, comparable_binary}`

  ## Tombstones table format

  `{handle, timestamp}`
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
  def tombstones_table_name(stack_id), do: :"write_buffer_tombstones:#{stack_id}"

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

  # Lookup functions

  @doc "Look up a shape by its handle. Returns {:ok, shape} or :not_found."
  def lookup_shape(stack_id, handle) do
    # Check tombstones first - if handle is being deleted, return not_found
    if :ets.member(tombstones_table_name(stack_id), handle) do
      :not_found
    else
      case :ets.lookup(shapes_table_name(stack_id), handle) do
        [{^handle, shape_binary, _comparable}] ->
          {:ok, :erlang.binary_to_term(shape_binary)}

        [] ->
          :not_found
      end
    end
  end

  @doc "Look up a handle by comparable shape binary. Returns {:ok, handle} or :not_found."
  def lookup_handle(stack_id, comparable_binary) do
    tombstones = tombstones_table_name(stack_id)
    pattern = {:_, :_, comparable_binary}

    case :ets.match_object(shapes_table_name(stack_id), pattern) do
      results when is_list(results) ->
        # Find first handle that's not in tombstones
        results
        |> Enum.find(fn {handle, _, _} -> not :ets.member(tombstones, handle) end)
        |> case do
          {handle, _, _} -> {:ok, handle}
          nil -> :not_found
        end

      [] ->
        :not_found
    end
  end

  @doc "Check if a handle is in the tombstones table (marked for deletion)"
  def is_tombstoned?(stack_id, handle) do
    :ets.member(tombstones_table_name(stack_id), handle)
  end

  @doc """
  Check if a handle exists in the buffer.
  Returns:
    - `false` if tombstoned (being deleted)
    - `true` if in shapes table (buffered, not yet in SQLite)
    - `:unknown` if not in buffer (may or may not exist in SQLite)
  """
  def has_handle?(stack_id, handle) do
    cond do
      :ets.member(tombstones_table_name(stack_id), handle) -> false
      :ets.member(shapes_table_name(stack_id), handle) -> true
      true -> :unknown
    end
  end

  @doc "Returns the number of pending operations in the buffer"
  def pending_operations_count(stack_id) do
    :ets.info(operations_table_name(stack_id), :size)
  end

  @doc "Returns all buffered shapes as a list of {handle, shape} tuples, excluding tombstoned handles"
  def list_buffered_shapes(stack_id) do
    tombstones = tombstones_table_name(stack_id)

    shapes_table_name(stack_id)
    |> :ets.tab2list()
    |> Enum.reject(fn {handle, _, _} -> :ets.member(tombstones, handle) end)
    |> Enum.map(fn {handle, shape_binary, _} -> {handle, :erlang.binary_to_term(shape_binary)} end)
  end

  @doc "Returns the count of buffered shapes (excluding tombstoned)"
  def buffered_shape_count(stack_id) do
    tombstones = tombstones_table_name(stack_id)

    shapes_table_name(stack_id)
    |> :ets.tab2list()
    |> Enum.count(fn {handle, _, _} -> not :ets.member(tombstones, handle) end)
  end

  @doc "Returns handles from the buffer that match any of the given relations (by OID)"
  def handles_for_relations(stack_id, relations) do
    if relations == [] do
      []
    else
      tombstones = tombstones_table_name(stack_id)
      # Extract just the OIDs for matching (Query only matches by OID)
      oids_set = relations |> Enum.map(fn {oid, _relation} -> oid end) |> MapSet.new()
      ops_table = operations_table_name(stack_id)

      # Scan ops_table for :add operations with matching OIDs
      ops_table
      |> :ets.tab2list()
      |> Enum.filter(fn
        {_ts, {:add, handle, _, _, _hash, shape_relations}, _flushing} ->
          not :ets.member(tombstones, handle) and
            Enum.any?(shape_relations, fn {oid, _} -> MapSet.member?(oids_set, oid) end)

        _ ->
          false
      end)
      |> Enum.map(fn {_ts, {:add, handle, _, _, _, _}, _} -> handle end)
    end
  end

  @doc "Returns the count of tombstoned handles"
  def tombstone_count(stack_id) do
    :ets.info(tombstones_table_name(stack_id), :size)
  end

  @doc "Returns all tombstoned handles as a MapSet"
  def tombstoned_handles(stack_id) do
    tombstones_table_name(stack_id)
    |> :ets.tab2list()
    |> Enum.map(fn {handle, _ts} -> handle end)
    |> MapSet.new()
  end

  # Write functions

  @doc "Add a shape to the buffer"
  def add_shape(stack_id, handle, shape_binary, comparable_binary, hash, relations) do
    shapes_table = shapes_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = timestamp()

    # Add to shapes lookup table (transient cache for handle_for_shape/shape_for_handle)
    true = :ets.insert(shapes_table, {handle, shape_binary, comparable_binary})

    # Queue operation for SQLite (contains full data including hash and relations)
    true =
      :ets.insert(
        ops_table,
        {ts, {:add, handle, shape_binary, comparable_binary, hash, relations}, false}
      )

    :ok
  end

  @doc "Mark a shape for removal"
  def remove_shape(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)
    tombstones_table = tombstones_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = timestamp()

    # Add to tombstones first (so has_handle? returns false immediately)
    true = :ets.insert(tombstones_table, {handle, ts})

    # Remove from shapes lookup table (if present)
    :ets.delete(shapes_table, handle)

    # Queue operation for SQLite
    true = :ets.insert(ops_table, {ts, {:remove, handle}, false})

    :ok
  end

  @doc "Queue a snapshot_started operation"
  def queue_snapshot_started(stack_id, handle) do
    ops_table = operations_table_name(stack_id)
    ts = timestamp()
    true = :ets.insert(ops_table, {ts, {:snapshot_started, handle}, false})
    :ok
  end

  @doc "Queue a snapshot_complete operation"
  def queue_snapshot_complete(stack_id, handle) do
    ops_table = operations_table_name(stack_id)
    ts = timestamp()
    true = :ets.insert(ops_table, {ts, {:snapshot_complete, handle}, false})
    :ok
  end

  @doc "Clear all data from all tables"
  def clear(stack_id) do
    :ets.delete_all_objects(shapes_table_name(stack_id))
    :ets.delete_all_objects(tombstones_table_name(stack_id))
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
    tombstones_table = tombstones_table_name(stack_id)

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

    :ets.new(tombstones_table, [
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
       tombstones_table: tombstones_table,
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
         %{
           ops_table: ops_table,
           shapes_table: shapes_table,
           tombstones_table: tombstones_table,
           stack_id: stack_id
         } = state
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
        # Clean up after successful flush
        Enum.each(entries, fn
          {_ts, {:add, handle, _, _, _, _}} ->
            # Remove from shapes table - it's now in SQLite
            :ets.delete(shapes_table, handle)

          {_ts, {:remove, handle}} ->
            # Remove from tombstones - removal is now in SQLite
            :ets.delete(tombstones_table, handle)

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
