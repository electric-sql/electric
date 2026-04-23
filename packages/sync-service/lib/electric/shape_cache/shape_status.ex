defmodule Electric.ShapeCache.ShapeStatus do
  @moduledoc """
  Keeps track of shape state.

  Can recover basic persisted shape metadata from shape storage to repopulate
  the in-memory cache.

  The shape cache then loads this and starts processes (storage and consumer)
  for each `{shape_handle, %Shape{}}` pair. These then use their attached storage
  to recover the status information for the shape (snapshot xmin and latest
  offset).

  The ETS metadata table name is part of the config because we need to be able
  to access the data in the ETS from anywhere, so there's an internal api,
  using the full state and an external api using just the table name.
  """
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.ShapeStatus.ShapeDb
  alias Electric.Telemetry.OpenTelemetry

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  require Logger

  @type stack_id() :: Electric.stack_id()
  @type shape_handle() :: Electric.shape_handle()
  @type shape_counts() :: %{
          total: non_neg_integer(),
          indexed: non_neg_integer(),
          unindexed: non_neg_integer()
        }

  # MUST be updated when Shape.comparable/1 changes.
  @version 8

  # Tuple format: {handle, hash, snapshot_started, last_read_time, generation}
  @shape_last_used_time_pos 4
  @shape_counts_key :counts

  @spec version() :: pos_integer()
  def version, do: @version

  @doc """
  Runs a validation step on the existing Shape data.

  The database path is dependent on both `@version` above and
  `ShapeDb.Connection`'s `@schema_version`.

  A change to either of those, or to the OTP release, will result in an empty
  database.
  """
  @spec initialize(stack_id()) :: :ok | {:error, term()}
  def initialize(stack_id) when is_stack_id(stack_id) do
    create_shape_meta_table(stack_id)

    {:ok, invalid_handles, valid_shape_count} = ShapeDb.validate_existing_shapes(stack_id)

    Logger.notice(
      "Found #{valid_shape_count} existing valid shapes and #{length(invalid_handles)} shapes in an invalid state"
    )

    if valid_shape_count == 0 do
      # delete any orphaned shape data
      stack_id
      |> Electric.ShapeCache.Storage.for_stack()
      |> Electric.ShapeCache.Storage.cleanup_all!()

      :ok
    else
      with :ok <-
             Electric.ShapeCache.ShapeCleaner.remove_shape_storage_async(
               stack_id,
               invalid_handles
             ),
           :ok <- rebuild_shape_routing_state(stack_id) do
        populate_shape_meta_table(stack_id, 0)
      end
    end
  end

  @doc """
  Refresh the shape meta table from SQLite without recreating it.

  Used on lock acquisition to pick up any shapes that were created/deleted
  by a previous instance while we were in read-only mode.
  """
  @spec refresh(stack_id()) :: :ok | {:error, term()}
  def refresh(stack_id) when is_stack_id(stack_id) do
    {:ok, invalid_handles, valid_shape_count} = ShapeDb.validate_existing_shapes(stack_id)

    Logger.notice(
      "Refreshing shape metadata: #{valid_shape_count} valid shapes, #{length(invalid_handles)} invalid"
    )

    with :ok <-
           Electric.ShapeCache.ShapeCleaner.remove_shape_storage_async(
             stack_id,
             invalid_handles
           ),
         :ok <- rebuild_shape_routing_state(stack_id) do
      # Use a generation counter to avoid clearing the table (which would race
      # with concurrent readers). Upsert all current shapes with a new generation,
      # then delete any entries still on the old generation.
      generation = System.unique_integer([:positive, :monotonic])
      populate_shape_meta_table(stack_id, generation)

      :ets.select_delete(shape_meta_table(stack_id), [
        {{:_, :_, :_, :_, :"$1"}, [{:"/=", :"$1", generation}], [true]}
      ])

      :ok
    end
  end

  @spec add_shape(stack_id(), Shape.t()) :: {:ok, shape_handle()} | {:error, term()}
  def add_shape(stack_id, shape) when is_stack_id(stack_id) do
    OpenTelemetry.with_child_span("shape_status.add_shape", [], stack_id, fn ->
      {_, shape_handle} = Shape.generate_id(shape)
      indexed? = Filter.indexed_shape?(shape)

      # Add the lookup last as it is the one that enables clients to find the shape
      with {:ok, shape_hash} <- ShapeDb.add_shape(stack_id, shape, shape_handle) do
        if :ets.insert_new(
             shape_meta_table(stack_id),
             # Generation 0 is safe here: add_shape only runs in active mode,
             # and refresh/1 (which sweeps by generation) only runs before active.
             # They are sequentially ordered by the Connection.Manager state machine.
             {shape_handle, shape_hash, false, nil, 0}
           ) do
          :ets.insert(shape_indexability_table(stack_id), {shape_handle, indexed?})
          increment_shape_counts(stack_id, indexed?)
          {:ok, shape_handle}
        else
          {:error, "duplicate shape #{inspect(shape_handle)}: #{inspect(shape)}"}
        end
      end
    end)
  end

  @spec list_shapes(stack_id()) :: [{shape_handle(), Shape.t()}]
  def list_shapes(stack_id) when is_stack_id(stack_id) do
    OpenTelemetry.with_child_span("shape_status.list_shapes", [], stack_id, fn ->
      stack_id
      |> ShapeDb.list_shapes!()
      |> topological_sort()
    end)
  end

  @spec topological_sort([{shape_handle(), Shape.t()}]) :: [{shape_handle(), Shape.t()}]
  defp topological_sort(handles_and_shapes, acc \\ [], visited \\ MapSet.new())
  defp topological_sort([], acc, _visited), do: Enum.reverse(acc) |> List.flatten()

  defp topological_sort(handles_and_shapes, acc, visited) do
    {appendable, missing_deps} =
      Enum.split_with(handles_and_shapes, fn {_, shape} ->
        Enum.all?(shape.shape_dependencies_handles, &MapSet.member?(visited, &1))
      end)

    visited = MapSet.new(appendable, &elem(&1, 0)) |> MapSet.union(visited)

    topological_sort(missing_deps, [appendable | acc], visited)
  end

  def reduce_shapes(stack_id, acc, reducer_fun)
      when is_stack_id(stack_id) and is_function(reducer_fun, 2) do
    ShapeDb.reduce_shapes(stack_id, acc, reducer_fun)
  end

  @spec count_shapes(stack_id()) :: non_neg_integer()
  def count_shapes(stack_id) when is_stack_id(stack_id) do
    case shape_counts(stack_id) do
      %{total: total} -> total
      :error -> ShapeDb.count_shapes!(stack_id)
    end
  end

  @spec shape_counts(stack_id()) :: shape_counts() | :error
  def shape_counts(stack_id) when is_stack_id(stack_id) do
    case :ets.lookup(shape_counts_table(stack_id), @shape_counts_key) do
      [{@shape_counts_key, total, indexed, unindexed}] ->
        %{total: total, indexed: indexed, unindexed: unindexed}

      [] ->
        :error
    end
  rescue
    ArgumentError -> :error
  end

  @spec list_shape_handles_for_relations(stack_id(), [Electric.oid_relation()]) :: [
          shape_handle()
        ]
  def list_shape_handles_for_relations(stack_id, relations) when is_stack_id(stack_id) do
    OpenTelemetry.with_child_span(
      "shape_status.list_shape_handles_for_relations",
      [],
      stack_id,
      fn ->
        ShapeDb.shape_handles_for_relations!(stack_id, relations)
      end
    )
  end

  @spec remove_shape(stack_id(), shape_handle()) :: :ok | {:error, term()}
  def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
    with :ok <- ShapeDb.remove_shape(stack_id, shape_handle) do
      :ets.delete(shape_meta_table(stack_id), shape_handle)
      decrement_shape_counts(stack_id, shape_cached_as_indexed?(stack_id, shape_handle))
      :ok
    end
  end

  @spec reset(stack_id()) :: :ok
  def reset(stack_id) when is_stack_id(stack_id) do
    :ok = ShapeDb.reset(stack_id)
    :ets.delete_all_objects(shape_meta_table(stack_id))
    :ets.delete_all_objects(shape_indexability_table(stack_id))
    put_shape_counts(stack_id, empty_shape_counts())
    :ok
  end

  @spec fetch_handle_by_shape(stack_id(), Shape.t()) :: {:ok, shape_handle()} | :error
  def fetch_handle_by_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    OpenTelemetry.with_child_span("shape_status.fetch_handle_by_shape", [], stack_id, fn ->
      ShapeDb.handle_for_shape(stack_id, shape)
    end)
  end

  @doc """
  Where as `fetch_handle_by_shape/2` *may* under high-write load return stale
  data -- not finding a shape that has been written -- due to SQLite's
  cross-connection durability when in WAL mode, where a connection reads
  against a snapshot of the data, this version does the lookup via the write
  connection, which is guaranteed to see all writes (SQLite connections can
  always see their own writes).

  This guarantees that will will return consistent restults at the cost of slower
  lookups as we're contending with access to the single write connection.
  """
  @spec fetch_handle_by_shape_critical(stack_id(), Shape.t()) :: {:ok, shape_handle()} | :error
  def fetch_handle_by_shape_critical(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    OpenTelemetry.with_child_span(
      "shape_status.fetch_handle_by_shape_critical",
      [],
      stack_id,
      fn ->
        ShapeDb.handle_for_shape_critical(stack_id, shape)
      end
    )
  end

  @spec fetch_shape_by_handle(stack_id(), shape_handle()) :: {:ok, Shape.t()} | :error
  def fetch_shape_by_handle(stack_id, shape_handle)
      when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    OpenTelemetry.with_child_span("shape_status.fetch_shape_by_handle", [], stack_id, fn ->
      ShapeDb.shape_for_handle(stack_id, shape_handle)
    end)
  end

  def has_shape_handle?(stack_id, shape_handle) do
    :ets.member(shape_meta_table(stack_id), shape_handle)
  end

  @spec shape_has_been_activated?(stack_id(), shape_handle()) :: boolean()
  def shape_has_been_activated?(stack_id, shape_handle) do
    last_used_timestamp =
      :ets.lookup_element(
        shape_meta_table(stack_id),
        shape_handle,
        @shape_last_used_time_pos,
        nil
      )

    not is_nil(last_used_timestamp)
  end

  @doc """
  Cheaply validate that a shape handle matches the shape definition by matching
  the shape's saved hash against the provided shape's hash.
  """
  @spec validate_shape_handle(stack_id(), shape_handle(), Shape.t()) :: :ok | :error
  def validate_shape_handle(stack_id, shape_handle, %Shape{} = shape)
      when is_stack_id(stack_id) do
    case :ets.lookup(shape_meta_table(stack_id), shape_handle) do
      [{^shape_handle, hash, _snapshot_started, _last_read, _gen}] ->
        if Shape.hash(shape) == hash, do: :ok, else: :error

      [] ->
        :error
    end
  end

  @spec mark_snapshot_started(stack_id(), shape_handle()) :: :ok | :error
  def mark_snapshot_started(stack_id, shape_handle) when is_stack_id(stack_id) do
    with true <- :ets.update_element(shape_meta_table(stack_id), shape_handle, {3, true}) do
      :ok
    else
      _ -> :error
    end
  end

  def snapshot_started?(stack_id, shape_handle) do
    case :ets.lookup(shape_meta_table(stack_id), shape_handle) do
      [{^shape_handle, _hash, snapshot_started, _last_read, _gen}] -> snapshot_started
      [] -> false
    end
  end

  @spec mark_snapshot_complete(stack_id(), shape_handle()) :: :ok | :error
  def mark_snapshot_complete(stack_id, shape_handle) when is_stack_id(stack_id) do
    OpenTelemetry.with_child_span("shape_status.mark_snapshot_complete", [], stack_id, fn ->
      ShapeDb.mark_snapshot_complete(stack_id, shape_handle)
    end)
  end

  @doc """
  Updates the last read time for the given shape to the current time.
  """
  def update_last_read_time_to_now(stack_id, shape_handle) when is_stack_id(stack_id) do
    update_last_read_time(stack_id, shape_handle, System.monotonic_time())
  end

  @doc """
  Sets the last read time for the given shape to the provided time.

  Used for tests, otherwise prefer `update_last_read_time_to_now/2`.
  """
  def update_last_read_time(stack_id, shape_handle, time) when is_stack_id(stack_id) do
    :ets.update_element(
      shape_meta_table(stack_id),
      shape_handle,
      {@shape_last_used_time_pos, time}
    )
  end

  def least_recently_used(_stack_id, 0) do
    {[], 0}
  end

  def least_recently_used(stack_id, shape_count) when is_stack_id(stack_id) do
    now = System.monotonic_time()
    table = shape_meta_table(stack_id)

    # Use :ets.foldl with gb_trees to efficiently maintain top N without copying
    # entire table into memory and without sorting on every iteration
    tree =
      :ets.foldl(
        fn
          # This shape has only just been created, so it's too young to be considered for
          # expiration.
          {_handle, _hash, _snapshot_started, nil, _gen}, tree ->
            tree

          {handle, _hash, _snapshot_started, last_read, _gen}, tree ->
            last_read_tuple = {last_read, handle}

            if :gb_trees.size(tree) < shape_count do
              # Insert into the tree until we reach the desired size
              :gb_trees.insert(last_read_tuple, true, tree)
            else
              # If entry being examined was used less recently than the
              # most recently used tracked entry in the tree so far, replace it
              {most_recent_tuple, _} = :gb_trees.largest(tree)

              if last_read_tuple < most_recent_tuple do
                tree = :gb_trees.delete(most_recent_tuple, tree)
                :gb_trees.insert(last_read_tuple, true, tree)
              else
                tree
              end
            end
        end,
        :gb_trees.empty(),
        table
      )

    # get a reversed iterator so the final handle list is in least- to
    # most-recently used order after the accumulator
    {handles, last_read} = lru_to_list(:gb_trees.iterator(tree, :reversed), [], nil)

    {handles, System.convert_time_unit(now - (last_read || now), :native, :second) / 60}
  end

  defp lru_to_list(iterator, handles, largest_last_read) do
    case :gb_trees.next(iterator) do
      {{last_read, handle}, _, iter} ->
        lru_to_list(iter, [handle | handles], largest_last_read || last_read)

      :none ->
        {handles, largest_last_read}
    end
  end

  @spec shape_meta_table(stack_id()) :: atom()
  defp shape_meta_table(stack_id),
    do: :"shape_meta_table:#{stack_id}"

  @spec shape_indexability_table(stack_id()) :: atom()
  defp shape_indexability_table(stack_id),
    do: :"shape_indexability_table:#{stack_id}"

  @spec shape_counts_table(stack_id()) :: atom()
  defp shape_counts_table(stack_id),
    do: :"shape_counts_table:#{stack_id}"

  defp create_shape_meta_table(stack_id) do
    ensure_state_table(shape_meta_table(stack_id),
      read_concurrency: true,
      write_concurrency: :auto
    )

    ensure_state_table(shape_indexability_table(stack_id),
      read_concurrency: true,
      write_concurrency: :auto
    )

    ensure_state_table(shape_counts_table(stack_id),
      read_concurrency: true,
      write_concurrency: true
    )

    :ets.delete_all_objects(shape_meta_table(stack_id))
    :ets.delete_all_objects(shape_indexability_table(stack_id))
    put_shape_counts(stack_id, empty_shape_counts())
  end

  defp populate_shape_meta_table(stack_id, generation) do
    start_time = System.monotonic_time()

    ShapeDb.reduce_shape_meta(
      stack_id,
      :ets.whereis(shape_meta_table(stack_id)),
      fn {handle, hash, snapshot_complete?}, table ->
        # any shapes where the snapshot didn't complete have been deleted
        # so there is no intermediate started-but-not-complete state
        # and completed implies started
        true = :ets.insert(table, {handle, hash, snapshot_complete?, start_time, generation})
        table
      end
    )

    :ok
  end

  defp rebuild_shape_routing_state(stack_id) do
    case ShapeDb.reduce_shapes(stack_id, {empty_shape_counts(), []}, fn {shape_handle, shape},
                                                                        {counts, entries} ->
           indexed? = Filter.indexed_shape?(shape)
           {update_shape_counts(counts, indexed?, 1), [{shape_handle, indexed?} | entries]}
         end) do
      {:error, _reason} = error ->
        error

      {counts, entries} ->
        :ets.delete_all_objects(shape_indexability_table(stack_id))

        if entries != [] do
          true = :ets.insert(shape_indexability_table(stack_id), entries)
        end

        put_shape_counts(stack_id, counts)
        :ok
    end
  end

  defp ensure_state_table(table_name, opts) do
    if :ets.whereis(table_name) == :undefined do
      :ets.new(table_name, [:named_table, :public, :set] ++ opts)
    end
  end

  defp empty_shape_counts do
    %{total: 0, indexed: 0, unindexed: 0}
  end

  defp put_shape_counts(stack_id, %{total: total, indexed: indexed, unindexed: unindexed}) do
    :ets.insert(shape_counts_table(stack_id), {@shape_counts_key, total, indexed, unindexed})
  end

  defp increment_shape_counts(stack_id, indexed?) do
    :ets.update_counter(
      shape_counts_table(stack_id),
      @shape_counts_key,
      [{2, 1}, {3, if(indexed?, do: 1, else: 0)}, {4, if(indexed?, do: 0, else: 1)}],
      {@shape_counts_key, 0, 0, 0}
    )
  end

  defp decrement_shape_counts(_stack_id, nil), do: :ok

  defp decrement_shape_counts(stack_id, indexed?) do
    :ets.update_counter(
      shape_counts_table(stack_id),
      @shape_counts_key,
      [{2, -1}, {3, if(indexed?, do: -1, else: 0)}, {4, if(indexed?, do: 0, else: -1)}],
      {@shape_counts_key, 0, 0, 0}
    )
  end

  defp shape_cached_as_indexed?(stack_id, shape_handle) do
    case :ets.take(shape_indexability_table(stack_id), shape_handle) do
      [{^shape_handle, indexed?}] -> indexed?
      [] -> nil
    end
  end

  defp update_shape_counts(%{total: total, indexed: indexed, unindexed: unindexed}, true, delta) do
    %{total: total + delta, indexed: indexed + delta, unindexed: unindexed}
  end

  defp update_shape_counts(%{total: total, indexed: indexed, unindexed: unindexed}, false, delta) do
    %{total: total + delta, indexed: indexed, unindexed: unindexed + delta}
  end
end
