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
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.ShapeStatus.ShapeDb

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]
  require Electric.Shapes.Shape

  require Logger

  @type stack_id() :: Electric.stack_id()
  @type shape_handle() :: Electric.shape_handle()
  @type stack_ref() :: atom() | stack_id() | [stack_id: stack_id()]

  @backup_version "v7"
  @backup_dir "shape_status_backups"

  @shape_last_used_time_pos 2
  @shape_hash_pos 2

  @spec initialize_from_storage(stack_ref()) :: :ok | {:error, term()}
  def initialize_from_storage(stack_ref) do
    storage = storage_for_stack_ref(stack_ref)
    stack_id = extract_stack_id(stack_ref)

    with backup_dir when is_binary(backup_dir) <- backup_dir(storage),
         true <- File.exists?(backup_dir),
         :ok <- load_backup(stack_id, backup_dir, storage) do
      Logger.info("Loaded shape status from backup at #{backup_dir}")
      :ok
    else
      _ ->
        Logger.debug("No shape status backup loaded, creating new tables")

        create_last_used_table(stack_id)
        create_relation_lookup_table(stack_id)
        create_hash_lookup_table(stack_id)
        ShapeDb.create(stack_id, @backup_version)

        load_all_shapes(stack_id, storage)
    end
  end

  @spec save_checkpoint(stack_ref()) :: :ok | {:error, term()}
  def save_checkpoint(stack_ref) do
    Logger.info("Saving shape status checkpoint for #{inspect(stack_ref)}")
    storage = storage_for_stack_ref(stack_ref)

    case backup_dir(storage) do
      nil ->
        {:error, :no_backup_dir_configured}

      backup_dir ->
        ShapeDb.store_backup(
          extract_stack_id(stack_ref),
          backup_dir,
          @backup_version
        )
    end
  end

  @spec add_shape(stack_ref(), Shape.t()) :: {:ok, shape_handle()} | {:error, term()}
  def add_shape(stack_ref, shape) do
    stack_id = extract_stack_id(stack_ref)
    {_, shape_handle} = Shape.generate_id(shape)
    {comparable_shape, shape_hash} = Shape.comparable_hash(shape)

    true =
      :ets.insert_new(
        shape_relation_lookup_table(stack_id),
        Enum.map(Shape.list_relations(shape), fn {oid, _name} -> {{oid, shape_handle}, nil} end)
      )

    true =
      :ets.insert_new(
        shape_last_used_table(stack_id),
        {shape_handle, System.monotonic_time()}
      )

    true =
      :ets.insert_new(
        shape_hash_lookup_table(stack_id),
        {shape_handle, shape_hash}
      )

    # Add the lookup last as it is the one that enables clients to find the shape
    :ok = ShapeDb.add_shape(stack_id, shape, comparable_shape, shape_handle)

    {:ok, shape_handle}
  end

  @spec list_shapes(stack_ref()) :: [{shape_handle(), Shape.t()}]
  def list_shapes(stack_ref) do
    stack_ref
    |> extract_stack_id()
    |> ShapeDb.list_shapes()
    |> topological_sort()
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

  @spec count_shapes(stack_ref()) :: non_neg_integer()
  def count_shapes(stack_ref) do
    :ets.info(shape_hash_lookup_table(stack_ref), :size)
  end

  @spec list_shape_handles_for_relations(stack_ref(), [Electric.oid_relation()]) :: [
          shape_handle()
        ]
  def list_shape_handles_for_relations(stack_ref, relations) do
    patterns =
      relations
      |> Enum.map(fn {oid, _} -> {{{oid, :"$1"}, :_}, [], [:"$1"]} end)

    :ets.select(shape_relation_lookup_table(stack_ref), patterns)
  end

  @spec remove_shape(stack_ref(), shape_handle()) :: {:ok, Shape.t()} | {:error, term()}
  def remove_shape(stack_ref, shape_handle) do
    stack_id = extract_stack_id(stack_ref)
    hash_lookup_table = shape_hash_lookup_table(stack_id)

    try do
      # Always delete the hash lookup first, so that we guarantee that no shape spec
      # is ever matched to a handle with incomplete information, since deleting with
      # select_delete can lead to inconsistent state
      shape = ShapeDb.remove_shape!(stack_id, shape_handle)

      :ets.delete(hash_lookup_table, shape_handle)

      relation_lookup_table = shape_relation_lookup_table(stack_id)

      Enum.each(Shape.list_relations(shape), fn {oid, _} ->
        :ets.delete(relation_lookup_table, {oid, shape_handle})
      end)

      :ets.delete(shape_last_used_table(stack_id), shape_handle)

      {:ok, shape}
    rescue
      # Sometimes we're calling cleanup when snapshot creation has failed for
      # some reason. In those cases we're not sure about the state of the ETS
      # keys, so we're doing our best to just delete everything without
      # crashing
      ArgumentError ->
        {:error, "No shape matching #{inspect(shape_handle)}"}
    end
  end

  @spec reset(stack_ref()) :: :ok
  def reset(stack_ref) do
    ShapeDb.reset(extract_stack_id(stack_ref))
    :ets.delete_all_objects(shape_hash_lookup_table(stack_ref))
    :ets.delete_all_objects(shape_relation_lookup_table(stack_ref))
    :ets.delete_all_objects(shape_last_used_table(stack_ref))
    :ok
  end

  @doc """
  Removes all ETS tables associated with the given stack reference.
  Used in tests for tearing down.
  """
  def remove(stack_ref) do
    stack_id = extract_stack_id(stack_ref)

    ShapeDb.delete(stack_id)

    try(do: :ets.delete(shape_hash_lookup_table(stack_id)), rescue: (_ in ArgumentError -> :ok))

    try(
      do: :ets.delete(shape_relation_lookup_table(stack_id)),
      rescue: (_ in ArgumentError -> :ok)
    )

    try(do: :ets.delete(shape_last_used_table(stack_id)), rescue: (_ in ArgumentError -> :ok))
    :ok
  end

  @spec fetch_handle_by_shape(stack_ref(), Shape.t()) :: {:ok, shape_handle()} | :error
  def fetch_handle_by_shape(stack_ref, %Shape{} = shape) do
    stack_id = extract_stack_id(stack_ref)

    case ShapeDb.handle_for_shape(stack_id, shape) do
      nil -> :error
      handle -> {:ok, handle}
    end
  end

  @spec fetch_shape_by_handle(stack_ref(), shape_handle()) :: {:ok, Shape.t()} | :error
  def fetch_shape_by_handle(stack_ref, shape_handle) when is_shape_handle(shape_handle) do
    stack_id = extract_stack_id(stack_ref)

    case ShapeDb.shape_for_handle(stack_id, shape_handle) do
      nil -> :error
      shape -> {:ok, shape}
    end
  end

  def has_shape_handle?(stack_ref, shape_handle) do
    case :ets.lookup_element(
           shape_hash_lookup_table(stack_ref),
           shape_handle,
           @shape_hash_pos,
           nil
         ) do
      nil -> false
      hash when is_integer(hash) -> true
    end
  rescue
    ArgumentError -> false
  end

  @doc """
  Cheaply validate that a shape handle matches the shape definition by matching
  the shape's saved hash against the provided shape's hash.
  """
  @spec validate_shape_handle(stack_ref(), shape_handle(), Shape.t()) :: :ok | :error
  def validate_shape_handle(stack_ref, shape_handle, %Shape{} = shape) do
    case :ets.lookup_element(
           shape_hash_lookup_table(stack_ref),
           shape_handle,
           @shape_hash_pos,
           nil
         ) do
      nil ->
        :error

      valid_hash when is_integer(valid_hash) ->
        case Shape.hash(shape) do
          ^valid_hash -> :ok
          _ -> :error
        end
    end
  rescue
    ArgumentError -> :error
  end

  @doc """
  Updates the last read time for the given shape to the current time.
  """
  def update_last_read_time_to_now(stack_ref, shape_handle) do
    update_last_read_time(stack_ref, shape_handle, System.monotonic_time())
  end

  @doc """
  Sets the last read time for the given shape to the provided time.

  Used for tests, otherwise prefer `update_last_read_time_to_now/2`.
  """
  def update_last_read_time(stack_ref, shape_handle, time) do
    :ets.update_element(
      shape_last_used_table(stack_ref),
      shape_handle,
      {@shape_last_used_time_pos, time}
    )
  end

  def least_recently_used(_stack_ref, 0) do
    {[], 0}
  end

  def least_recently_used(stack_ref, shape_count) do
    now = System.monotonic_time()
    table = shape_last_used_table(stack_ref)

    # Use :ets.foldl with gb_trees to efficiently maintain top N without copying
    # entire table into memory and without sorting on every iteration
    tree =
      :ets.foldl(
        fn {handle, last_read}, tree ->
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

  @spec extract_stack_id(stack_ref()) :: stack_id()
  defp extract_stack_id(stack_ref) when is_list(stack_ref) or is_map(stack_ref),
    do: Access.fetch!(stack_ref, :stack_id)

  defp extract_stack_id(stack_ref) when is_stack_id(stack_ref), do: stack_ref

  @spec shape_hash_lookup_table(stack_ref()) :: atom()
  defp shape_hash_lookup_table(stack_ref),
    do: :"shape_hash_lookup_table:#{extract_stack_id(stack_ref)}"

  @spec shape_relation_lookup_table(stack_ref()) :: atom()
  defp shape_relation_lookup_table(stack_ref),
    do: :"shape_relation_lookup_table:#{extract_stack_id(stack_ref)}"

  @spec shape_last_used_table(stack_ref()) :: atom()
  defp shape_last_used_table(stack_ref),
    do: :"shape_last_used_table:#{extract_stack_id(stack_ref)}"

  defp create_hash_lookup_table(stack_id) do
    hash_lookup_table = shape_hash_lookup_table(stack_id)

    :ets.new(hash_lookup_table, [
      :named_table,
      :public,
      :set,
      write_concurrency: :auto,
      read_concurrency: true
    ])

    hash_lookup_table
  end

  defp create_relation_lookup_table(stack_id) do
    relation_lookup_table = shape_relation_lookup_table(stack_id)

    :ets.new(relation_lookup_table, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto
    ])

    relation_lookup_table
  end

  defp create_last_used_table(stack_id) do
    last_used_table = shape_last_used_table(stack_id)

    :ets.new(last_used_table, [
      :named_table,
      :public,
      :set,
      write_concurrency: :auto
    ])

    last_used_table
  end

  defp load_all_shapes(stack_id, storage) do
    Electric.Telemetry.OpenTelemetry.with_span(
      "shape_status.load_all_shapes",
      [],
      stack_id,
      fn ->
        with {:ok, shape_handles} <- Storage.get_all_stored_shape_handles(storage) do
          load_shapes(stack_id, shape_handles, storage)
        end
      end
    )
  end

  defp load_shapes(stack_id, shape_handles, storage) do
    _ = Electric.Postgres.supported_types()

    start_time = System.monotonic_time()

    shape_data = Storage.get_stored_shapes(storage, shape_handles)

    {shape_db_tuples, hash_lookup_tuples, last_used_tuples, relation_lookup_tuples, num_shapes} =
      Enum.reduce(
        shape_data,
        {[], [], [], [], 0},
        fn
          {_shape_handle, {:error, _reason}}, acc ->
            acc

          {shape_handle, {:ok, shape}},
          {
            shape_db_tuples,
            hash_lookup_tuples,
            last_used_tuples,
            relation_lookup_tuples,
            num_shapes
          } ->
            relations = Shape.list_relations(shape)
            {comparable, shape_hash} = Shape.comparable_hash(shape)

            shape_db_tuples = [{shape, comparable, shape_handle} | shape_db_tuples]
            hash_lookup_tuples = [{shape_handle, shape_hash} | hash_lookup_tuples]
            last_used_tuples = [{shape_handle, start_time} | last_used_tuples]

            relation_lookup_tuples =
              Enum.map(relations, fn {oid, _} -> {{oid, shape_handle}, nil} end) ++
                relation_lookup_tuples

            {shape_db_tuples, hash_lookup_tuples, last_used_tuples, relation_lookup_tuples,
             num_shapes + 1}
        end
      )

    :ets.insert(shape_relation_lookup_table(stack_id), relation_lookup_tuples)
    :ets.insert(shape_last_used_table(stack_id), last_used_tuples)
    :ets.insert(shape_hash_lookup_table(stack_id), hash_lookup_tuples)

    ShapeDb.load(stack_id, shape_db_tuples)

    restore_dependency_handles(stack_id, shape_db_tuples, storage)

    Logger.info(fn ->
      duration =
        System.convert_time_unit(System.monotonic_time() - start_time, :native, :millisecond)

      "Loaded #{num_shapes} shapes into #{inspect(__MODULE__)} in #{duration}ms"
    end)

    :ok
  end

  defp restore_dependency_handles(stack_id, shape_db_tuples, storage) do
    shape_db_tuples
    |> Enum.map(fn {shape, _comparable, handle} -> {handle, shape} end)
    |> Enum.filter(fn {_handle, shape} ->
      Shape.has_dependencies(shape) and not Shape.dependency_handles_known?(shape)
    end)
    |> Enum.each(fn {handle, %Shape{shape_dependencies: deps} = shape} ->
      handle_results = Enum.map(deps, &fetch_handle_by_shape(stack_id, &1))

      if not Enum.any?(handle_results, &match?(:error, &1)) do
        handles = Enum.map(handle_results, fn {:ok, h} -> h end)
        ShapeDb.update_shape(stack_id, handle, %{shape | shape_dependencies_handles: handles})
      else
        Logger.warning("Shape #{inspect(handle)} has dependencies but some are unknown")
        remove_shape(stack_id, handle)
        Storage.cleanup!(storage, handle)
      end
    end)
  end

  defp remove_shapes_with_invalid_dependencies(_stack_id, removed_handles, _storage)
       when map_size(removed_handles) == 0 do
    :ok
  end

  defp remove_shapes_with_invalid_dependencies(stack_id, removed_handles, storage) do
    shapes_to_remove =
      ShapeDb.reduce_shapes(stack_id, [], fn {handle, shape}, acc ->
        if Enum.any?(shape.shape_dependencies_handles, &MapSet.member?(removed_handles, &1)) do
          [handle | acc]
        else
          acc
        end
      end)

    if shapes_to_remove == [] do
      :ok
    else
      Enum.each(shapes_to_remove, fn handle ->
        Logger.warning("Removing shape #{inspect(handle)} because its dependency was invalidated")

        remove_shape(stack_id, handle)
        Storage.cleanup!(storage, handle)
      end)

      # Recursively check for more shapes that depended on the ones we just removed
      remove_shapes_with_invalid_dependencies(
        stack_id,
        MapSet.new(shapes_to_remove),
        storage
      )
    end
  end

  defp load_backup(stack_id, backup_dir, storage) do
    with :ok <- ShapeDb.restore(stack_id, backup_dir, @backup_version),
         {:ok, stored_handles} <- Storage.get_all_stored_shape_handles(storage) do
      hash_lookup_table = create_hash_lookup_table(stack_id)
      last_used_table = create_last_used_table(stack_id)
      relation_lookup_table = create_relation_lookup_table(stack_id)

      # repopulate last used table with current time and relation lookup table
      # from the shape definition
      in_memory_handles =
        ShapeDb.reduce_shapes(stack_id, MapSet.new(), fn {shape_handle, shape}, acc ->
          :ets.insert(hash_lookup_table, {shape_handle, Shape.hash(shape)})
          :ets.insert(last_used_table, {shape_handle, System.monotonic_time()})

          :ets.insert(
            relation_lookup_table,
            Enum.map(Shape.list_relations(shape), fn {oid, _name} ->
              {{oid, shape_handle}, nil}
            end)
          )

          MapSet.put(acc, shape_handle)
        end)

      # reconcile stored vs in-memory handles by loading any missing stored shapes
      # and removing any invalid in-memory shapes
      missing_stored_handles = MapSet.difference(stored_handles, in_memory_handles)
      invalid_in_memory_handles = MapSet.difference(in_memory_handles, stored_handles)

      if MapSet.size(missing_stored_handles) > 0,
        do: load_shapes(stack_id, missing_stored_handles, storage)

      Enum.each(invalid_in_memory_handles, fn handle -> remove_shape(stack_id, handle) end)

      remove_shapes_with_invalid_dependencies(stack_id, invalid_in_memory_handles, storage)

      :ok
    else
      {:error, reason} ->
        Logger.warning(
          "Failed to restore shape status tables with #{inspect(reason)} - aborting restore"
        )

        :ok = ShapeDb.delete(stack_id)
        {:error, reason}
    end
  end

  def backup_dir(storage) do
    case Storage.metadata_backup_dir(storage) do
      nil -> nil
      dir -> Path.join(dir, @backup_dir)
    end
  end

  @spec storage_for_stack_ref(stack_ref()) :: Storage.storage()
  defp storage_for_stack_ref(stack_ref) do
    stack_ref
    |> extract_stack_id()
    |> Storage.for_stack()
  end
end
