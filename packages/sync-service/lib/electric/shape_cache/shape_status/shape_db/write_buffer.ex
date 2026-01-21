defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.WriteBuffer do
  @moduledoc """
  Buffers SQLite metadata writes using ETS for immediate return to callers,
  then batches and flushes to SQLite in the background.

  This prevents timeout cascades when many concurrent clients create shapes
  after a redeploy.

  ## Architecture

  Two ETS tables are used:

  1. **Operations table** (ordered_set) - queue of operations to flush to SQLite
  2. **Shapes table** (set) - buffered shapes, comparable index, and tombstones with namespaced keys

  ## How it works

  1. When a shape is added, insert into shapes table and queue :add operation
  2. When a shape is removed, insert tombstone and queue :remove operation
  3. GenServer polls every 50ms and flushes pending operations to SQLite
  4. After successful flush, clean up entries from shapes table

  ## Operations table format

  `{{monotonic_time, unique_int}, operation, flushing}`

  ## Shapes table key formats

  - `{{:shape, handle}, shape_binary, comparable_binary}` - shape data
  - `{{:comparable, comparable_binary}, handle}` - reverse index for O(1) lookup
  - `{{:tombstone, handle}, timestamp}` - handles marked for deletion
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

  @doc "Returns a unique, ordered key for operations table entries"
  def op_key, do: {System.monotonic_time(), System.unique_integer([:positive, :monotonic])}

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
    shapes_table = shapes_table_name(stack_id)

    # Check tombstones first - if handle is being deleted, return not_found
    if :ets.member(shapes_table, {:tombstone, handle}) do
      :not_found
    else
      case :ets.lookup(shapes_table, {:shape, handle}) do
        [{{:shape, ^handle}, shape_binary, _comparable}] ->
          {:ok, :erlang.binary_to_term(shape_binary)}

        [] ->
          :not_found
      end
    end
  end

  @doc "Look up a handle by comparable shape binary. Returns {:ok, handle} or :not_found."
  def lookup_handle(stack_id, comparable_binary) do
    shapes_table = shapes_table_name(stack_id)

    case :ets.lookup(shapes_table, {:comparable, comparable_binary}) do
      [{{:comparable, ^comparable_binary}, handle}] ->
        if :ets.member(shapes_table, {:tombstone, handle}), do: :not_found, else: {:ok, handle}

      [] ->
        :not_found
    end
  end

  @doc "Check if a handle is in the tombstones (marked for deletion)"
  def is_tombstoned?(stack_id, handle) do
    :ets.member(shapes_table_name(stack_id), {:tombstone, handle})
  end

  @doc """
  Check if a handle exists in the buffer.
  Returns:
    - `false` if tombstoned (being deleted)
    - `true` if in shapes table (buffered, not yet in SQLite)
    - `:unknown` if not in buffer (may or may not exist in SQLite)

  Note: Checks tombstone last since it's the authoritative "delete in progress"
  signal, avoiding a race where tombstone is added between checks.
  """
  def has_handle?(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)
    has_shape = :ets.member(shapes_table, {:shape, handle})
    is_tombstoned = :ets.member(shapes_table, {:tombstone, handle})

    cond do
      is_tombstoned -> false
      has_shape -> true
      true -> :unknown
    end
  end

  @doc "Returns the number of pending operations in the buffer"
  def pending_operations_count(stack_id) do
    :ets.info(operations_table_name(stack_id), :size)
  end

  @doc "Returns all buffered shapes as a list of {handle, shape} tuples, excluding tombstoned handles, sorted by handle"
  def list_buffered_shapes(stack_id) do
    tombstones = tombstoned_handles(stack_id)

    shapes_table_name(stack_id)
    |> :ets.match({{:shape, :"$1"}, :"$2", :_})
    |> Enum.reject(fn [handle, _] -> MapSet.member?(tombstones, handle) end)
    |> Enum.map(fn [handle, shape_binary] -> {handle, :erlang.binary_to_term(shape_binary)} end)
    |> Enum.sort_by(fn {handle, _} -> handle end)
  end

  @doc "Returns the count of buffered shapes (excluding tombstoned)"
  def buffered_shape_count(stack_id) do
    tombstones = tombstoned_handles(stack_id)

    shapes_table_name(stack_id)
    |> :ets.match({{:shape, :"$1"}, :_, :_})
    |> Enum.count(fn [handle] -> not MapSet.member?(tombstones, handle) end)
  end

  @doc "Returns handles from the buffer that match any of the given relations (by OID)"
  def handles_for_relations(stack_id, relations) do
    if relations == [] do
      []
    else
      tombstones = tombstoned_handles(stack_id)
      oids_set = relations |> Enum.map(fn {oid, _relation} -> oid end) |> MapSet.new()

      operations_table_name(stack_id)
      |> :ets.match({:_, {:add, :"$1", :_, :_, :_, :"$2"}, :_})
      |> Enum.filter(fn [handle, shape_relations] ->
        not MapSet.member?(tombstones, handle) and
          Enum.any?(shape_relations, fn {oid, _} -> MapSet.member?(oids_set, oid) end)
      end)
      |> Enum.map(fn [handle, _] -> handle end)
    end
  end

  @doc "Returns the count of tombstoned handles that are in SQLite (not buffer-only)"
  def sqlite_tombstone_count(stack_id) do
    buffered_add_handles =
      operations_table_name(stack_id)
      |> :ets.match({:_, {:add, :"$1", :_, :_, :_, :_}, :_})
      |> MapSet.new(fn [h] -> h end)

    shapes_table_name(stack_id)
    |> :ets.match({{:tombstone, :"$1"}, :_})
    |> Enum.count(fn [handle] -> not MapSet.member?(buffered_add_handles, handle) end)
  end

  @doc "Returns all tombstoned handles as a MapSet"
  def tombstoned_handles(stack_id) do
    shapes_table_name(stack_id)
    |> :ets.match({{:tombstone, :"$1"}, :_})
    |> MapSet.new(fn [h] -> h end)
  end

  # Write functions

  @doc "Add a shape to the buffer"
  def add_shape(stack_id, handle, shape_binary, comparable_binary, hash, relations) do
    shapes_table = shapes_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = op_key()

    true =
      :ets.insert(shapes_table, [
        {{:shape, handle}, shape_binary, comparable_binary},
        {{:comparable, comparable_binary}, handle}
      ])

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
    ts = op_key()

    # insert_new is atomic - returns false if already tombstoned, preventing double-remove
    case :ets.insert_new(shapes_table, {{:tombstone, handle}, ts}) do
      true ->
        case :ets.lookup(shapes_table, {:shape, handle}) do
          [{{:shape, ^handle}, _shape_binary, comparable_binary}] ->
            :ets.delete(shapes_table, {:comparable, comparable_binary})

          [] ->
            :ok
        end

        :ets.delete(shapes_table, {:shape, handle})

        ops_table = operations_table_name(stack_id)
        true = :ets.insert(ops_table, {ts, {:remove, handle}, false})

        :ok

      false ->
        :ok
    end
  end

  @doc "Queue a snapshot_started operation"
  def queue_snapshot_started(stack_id, handle) do
    ops_table = operations_table_name(stack_id)
    ts = op_key()
    true = :ets.insert(ops_table, {ts, {:snapshot_started, handle}, false})
    :ok
  end

  @doc "Queue a snapshot_complete operation"
  def queue_snapshot_complete(stack_id, handle) do
    ops_table = operations_table_name(stack_id)
    ts = op_key()
    true = :ets.insert(ops_table, {ts, {:snapshot_complete, handle}, false})
    :ok
  end

  @doc "Clear all data from all tables"
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
         %{
           ops_table: ops_table,
           shapes_table: shapes_table,
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
          {_ts, {:add, handle, _shape_binary, comparable_binary, _hash, _relations}} ->
            # Remove from shapes table - it's now in SQLite
            :ets.delete(shapes_table, {:shape, handle})
            :ets.delete(shapes_table, {:comparable, comparable_binary})

          {_ts, {:remove, handle}} ->
            # Remove tombstone - removal is now in SQLite
            :ets.delete(shapes_table, {:tombstone, handle})

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
      else
        # Reset flushing flag so entries can be retried on next poll
        Enum.each(entries, fn {ts, _op} ->
          :ets.update_element(ops_table, ts, {3, false})
        end)
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
          :ok = Query.remove_shape(conn, handle)

        {_ts, {:snapshot_started, handle}} ->
          :ok = Query.mark_snapshot_started(conn, handle)

        {_ts, {:snapshot_complete, handle}} ->
          :ok = Query.mark_snapshot_complete(conn, handle)
      end)

      :ok
    end)
  rescue
    e ->
      Logger.error("WriteBuffer batch write failed: #{inspect(e)}")
      :error
  end
end
