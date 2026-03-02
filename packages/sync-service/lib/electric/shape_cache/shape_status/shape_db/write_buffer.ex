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

  ## Crash recovery

  If the system crashes, all in-flight writes in the operations table will be
  lost. On reboot clients of the in-flight shapes will receive `must-refetch`
  responses and the shapes will be re-inserted into the buffer.

  This will leave orphaned shape data in the storage implementation, as we are
  losing all references to the handle. We will need some background
  reconciliation process that culls orphaned storage data.

  ## Operations table format

  `{{monotonic_time, unique_int}, operation, flushing}`

  ## Shapes table key formats

  - `{:pending_count, integer}` - count of shapes pending addition
  - `{{:shape, handle}, shape, comparable}` - shape data
  - `{{:comparable, comparable}, handle}` - reverse index for O(1) lookup
  - `{{:tombstone, handle}, timestamp}` - handles marked for deletion
  """

  use GenServer

  require Logger

  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Query
  alias Electric.Telemetry.OpenTelemetry

  import Electric, only: [is_stack_id: 1]

  @poll_interval 100
  # keep this low-ish so that this process yields the write connection
  # to handle_for_shape_critical/2 reasonably often.
  @max_drain_per_cycle 100

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

  @doc """
  Disable flushing of buffered actions to db. Useful for testing
  """
  def pause_flush(stack_id) when is_stack_id(stack_id) do
    GenServer.call(name(stack_id), {:pause, true})
  end

  @doc """
  Re-enable flushing of buffered actions to db. Useful for testing
  """
  def resume_flush(stack_id) when is_stack_id(stack_id) do
    GenServer.call(name(stack_id), {:pause, false})
  end

  # Lookup functions

  @doc "Look up a shape by its handle. Returns {:ok, shape} or :not_found."
  def lookup_shape(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)

    case :ets.lookup(shapes_table, {:shape, handle}) do
      [{{:shape, ^handle}, shape, _comparable}] ->
        if :ets.member(shapes_table, {:tombstone, handle}) do
          :not_found
        else
          {:ok, shape}
        end

      [] ->
        :not_found
    end
  end

  @doc "Look up a handle by comparable shape binary. Returns {:ok, handle} or :not_found."
  def lookup_handle(stack_id, comparable_shape) do
    shapes_table = shapes_table_name(stack_id)

    case :ets.lookup(shapes_table, {:comparable, comparable_shape}) do
      [{{:comparable, ^comparable_shape}, handle}] ->
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

  @doc "Gives the change to the total count of shapes in the database once all buffered writes are applied"
  def pending_count_diff(stack_id) do
    :ets.lookup_element(shapes_table_name(stack_id), :count_add, 2) -
      :ets.lookup_element(shapes_table_name(stack_id), :count_remove, 2)
  end

  @doc "Returns all buffered shapes as a list of {handle, shape} tuples, excluding tombstoned handles, sorted by handle"
  def list_buffered_shapes(stack_id) do
    tombstones = tombstoned_handles(stack_id)

    shapes_table_name(stack_id)
    |> :ets.match({{:shape, :"$1"}, :"$2", :_})
    |> Enum.reject(fn [handle, _] -> MapSet.member?(tombstones, handle) end)
    |> Enum.map(fn [handle, shape] -> {handle, shape} end)
    |> Enum.sort_by(fn {handle, _} -> handle end)
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

  @doc "Returns all tombstoned handles as a MapSet"
  def tombstoned_handles(stack_id) do
    shapes_table_name(stack_id)
    |> :ets.match({{:tombstone, :"$1"}, :_})
    |> MapSet.new(fn [h] -> h end)
  end

  # Write functions

  @doc "Add a shape to the buffer"
  def add_shape(stack_id, handle, shape, comparable, hash, relations) do
    shapes_table = shapes_table_name(stack_id)
    ops_table = operations_table_name(stack_id)
    ts = op_key()

    if :ets.insert_new(shapes_table, [
         {{:shape, handle}, shape, comparable},
         {{:comparable, comparable}, handle}
       ]) do
      :ets.update_counter(shapes_table, :count_add, 1)

      # Queue operation for SQLite (contains full data including hash and relations)
      true =
        :ets.insert(
          ops_table,
          {ts, {:add, handle, shape, comparable, hash, relations}, false}
        )

      :ok
    else
      {:error, "duplicate shape #{handle} #{inspect(shape)}"}
    end
  end

  @doc "Mark a shape for removal"
  def remove_shape(stack_id, handle) do
    shapes_table = shapes_table_name(stack_id)
    ts = op_key()

    # insert_new is atomic - returns false if already tombstoned, preventing double-remove
    case :ets.insert_new(shapes_table, {{:tombstone, handle}, ts}) do
      true ->
        case :ets.lookup(shapes_table, {:shape, handle}) do
          [{{:shape, ^handle}, _shape, comparable}] ->
            :ets.delete(shapes_table, {:comparable, comparable})

          [] ->
            :ok
        end

        :ets.delete(shapes_table, {:shape, handle})
        :ets.update_counter(shapes_table, :count_remove, 1)

        ops_table = operations_table_name(stack_id)
        true = :ets.insert(ops_table, {ts, {:remove, handle}, false})

        :ok

      false ->
        :ok
    end
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
    initialize_counts(shapes_table_name(stack_id))
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

    initialize_counts(shapes_table)

    {:ok,
     schedule_poll(%{
       stack_id: stack_id,
       ops_table: ops_table,
       shapes_table: shapes_table,
       manual_flush_only: manual_flush_only,
       paused: false
     })}
  end

  defp initialize_counts(shapes_table) do
    :ets.insert(shapes_table, [{:count_add, 0}, {:count_remove, 0}])
  end

  @impl GenServer
  def handle_info(:poll, %{manual_flush_only: false} = state) do
    flush_until_empty(state)

    {:noreply, schedule_poll(state), :hibernate}
  end

  def handle_info(msg, state) do
    Logger.warning("Received unexpected message #{inspect(msg)}")
    {:noreply, state}
  end

  @impl GenServer
  def handle_call(:flush_sync, _from, state) do
    {:reply, flush_until_empty(%{state | paused: false}), state}
  end

  def handle_call({:pause, paused?}, _from, state) do
    {:reply, :ok, %{state | paused: paused?}}
  end

  @impl GenServer
  def terminate(_reason, state) do
    flush_until_empty(state)
  end

  defp schedule_poll(%{manual_flush_only: true} = state) do
    state
  end

  defp schedule_poll(state) do
    Process.send_after(self(), :poll, @poll_interval)
    state
  end

  defp flush_until_empty(%{paused: true} = _state) do
    :ok
  end

  defp flush_until_empty(state) do
    state
    |> mark_and_collect_entries(@max_drain_per_cycle)
    |> flush_entries(state)
  end

  defp flush_entries([], _state) do
    :ok
  end

  defp flush_entries(
         entries,
         %{ops_table: ops_table, shapes_table: shapes_table, stack_id: stack_id} = state
       ) do
    OpenTelemetry.with_span(
      "shape_db.write_buffer.flush",
      [entry_count: length(entries)],
      stack_id,
      fn ->
        case do_batch_write(stack_id, entries) do
          :ok ->
            Enum.each(entries, fn {ts, op} ->
              case op do
                {:add, handle, _shape, comparable, _hash, _relations} ->
                  :ets.delete(shapes_table, {:shape, handle})
                  :ets.delete(shapes_table, {:comparable, comparable})
                  :ets.update_counter(shapes_table, :count_add, {2, -1, 0, 0})
                  {:add, handle}

                {:remove, handle} ->
                  :ets.delete(shapes_table, {:tombstone, handle})
                  :ets.update_counter(shapes_table, :count_remove, {2, -1, 0, 0})
                  op

                _ ->
                  op
              end
              |> tap(&Logger.debug(fn -> ["ShapeDb: committed ", inspect(&1)] end))

              :ets.delete(ops_table, ts)
            end)

            flush_until_empty(state)

          {:error, _reason} = error ->
            # Reset flushing flag so entries can be retried on next poll
            Enum.each(entries, fn {ts, _op} ->
              :ets.update_element(ops_table, ts, {3, false})
            end)

            error
        end
      end
    )
  end

  defp mark_and_collect_entries(%{ops_table: ops_table}, limit) do
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
        {_ts, {:add, handle, shape, comparable, hash, relations}} ->
          :ok = Query.add_shape(conn, handle, shape, comparable, hash, relations)

        {_ts, {:remove, handle}} ->
          case Query.remove_shape(conn, handle) do
            {:error, {:enoshape, ^handle}} ->
              # tried to delete a shape that doesn't exist, in which case the
              # failure is ok, it's already deleted
              Logger.warning("Attempt to delete non-existent shape #{inspect(handle)}")

            :ok ->
              :ok

            error ->
              raise "Failed to remove shape: #{inspect(error)}"
          end

        {_ts, {:snapshot_complete, handle}} ->
          with :error <- Query.mark_snapshot_complete(conn, handle) do
            # `Query.mark_snapshot_complete` only returns `:error` if the query
            # modified 0 rows, i.e. the shape does not exist. Rather than crash
            # just warn as we can continue in this scenario.
            Logger.warning("Unable to mark snapshot complete: #{handle} does not exist")
          end
      end)

      :ok
    end)
  rescue
    e ->
      Logger.error(
        "WriteBuffer batch write failed: #{Exception.format(:error, e, __STACKTRACE__)}"
      )

      {:error, Exception.message(e)}
  end
end
