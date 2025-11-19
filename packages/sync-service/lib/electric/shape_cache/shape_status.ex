defmodule Electric.ShapeCache.ShapeStatusBehaviour do
  @moduledoc """
  Behaviour defining the ShapeStatus functions
  """
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset

  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()
  @type xmin() :: non_neg_integer()

  @type stack_id() :: Electric.stack_id()

  if Mix.env() == :test do
    @type stack_ref() ::
            atom()
            | stack_id()
            | [stack_id: stack_id()]
            | %{shape_meta_table: atom(), shape_last_used_table: atom()}
  else
    @type stack_ref() :: atom() | stack_id() | [stack_id: stack_id()]
  end

  @callback initialize_from_storage(stack_ref(), Electric.ShapeCache.Storage.storage()) ::
              :ok | {:error, term()}
  @callback terminate(stack_ref(), Electric.ShapeCache.Storage.storage()) ::
              :ok | {:error, term()}
  @callback list_shapes(stack_ref()) :: [{shape_handle(), Shape.t()}]

  @callback list_shape_handles_for_relations(stack_ref(), [Electric.oid_relation()]) :: [
              shape_handle()
            ]
  @callback count_shapes(stack_ref()) :: non_neg_integer()
  @callback get_existing_shape(stack_ref(), Shape.t() | shape_handle()) ::
              {shape_handle(), LogOffset.t()} | nil
  @callback fetch_shape_by_handle(stack_ref(), shape_handle()) :: {:ok, Shape.t()} | :error
  @callback add_shape(stack_ref(), Shape.t()) :: {:ok, shape_handle()} | {:error, term()}
  @callback initialise_shape(stack_ref(), shape_handle(), LogOffset.t()) :: :ok
  @callback set_latest_offset(stack_ref(), shape_handle(), LogOffset.t()) :: :ok
  @callback mark_snapshot_as_started(stack_ref(), shape_handle()) :: :ok
  @callback snapshot_started?(stack_ref(), shape_handle()) :: boolean()
  @callback remove_shape(stack_ref(), shape_handle()) :: {:ok, Shape.t()} | {:error, term()}
  @callback reset(stack_ref()) :: :ok
end

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
  alias Electric.Replication.LogOffset

  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]

  require Logger

  @behaviour Electric.ShapeCache.ShapeStatusBehaviour

  @typep stack_ref() :: Electric.ShapeCache.ShapeStatusBehaviour.stack_ref()
  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()
  @type table() :: atom() | reference()
  @type t() :: Keyword.t() | binary() | atom()

  @backup_version "v3"
  @backup_dir "shape_status_backups"

  @shape_meta_shape_pos 2
  @shape_meta_snapshot_started_pos 3
  @shape_meta_latest_offset_pos 4

  @impl true
  def initialize_from_storage(stack_ref, storage) do
    with backup_dir when is_binary(backup_dir) <- backup_dir(storage),
         true <- File.exists?(backup_dir),
         :ok <- load_backup(stack_ref, backup_dir, storage) do
      Logger.info("Loaded shape status from backup at #{backup_dir}")
      :ok
    else
      _ ->
        Logger.debug("No shape status backup loaded, creating new tables")

        create_last_used_table(stack_ref)
        create_relation_lookup_table(stack_ref)
        create_meta_table(stack_ref)
        create_hash_lookup_table(stack_ref)

        load(stack_ref, storage)
    end
  end

  @impl true
  def terminate(stack_ref, storage) do
    case backup_dir(storage) do
      nil -> {:error, :no_backup_dir_configured}
      backup_dir -> store_backup(stack_ref, backup_dir)
    end
  end

  @impl true
  def add_shape(stack_ref, shape) do
    {_, shape_handle} = Shape.generate_id(shape)
    # For fresh snapshots we're setting "latest" offset to be a highest possible virtual offset,
    # which is needed because while the snapshot is being made we DON'T update this ETS table.
    # We could, but that would required making the Storage know about this module and I don't like that.
    offset = LogOffset.last_before_real_offsets()

    true = :ets.insert_new(shape_meta_table(stack_ref), {shape_handle, shape, false, offset})

    true =
      :ets.insert_new(
        shape_relation_lookup_table(stack_ref),
        Enum.map(Shape.list_relations(shape), fn {oid, _name} -> {{oid, shape_handle}, nil} end)
      )

    true =
      :ets.insert_new(shape_last_used_table(stack_ref), {shape_handle, System.monotonic_time()})

    # Add the lookup last as it is the one that enables clients to find the shape
    true =
      :ets.insert_new(shape_hash_lookup_table(stack_ref), {Shape.comparable(shape), shape_handle})

    {:ok, shape_handle}
  end

  @impl true
  def list_shapes(stack_ref) do
    shape_meta_table(stack_ref)
    |> :ets.select([
      {
        {:"$1", :"$2", :_, :_},
        [],
        [{{:"$1", :"$2"}}]
      }
    ])
    |> topological_sort()
  end

  defp list_shape_handles(stack_ref) do
    shape_hash_lookup_table(stack_ref) |> :ets.select([{{:_, :"$1"}, [], [:"$1"]}])
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

  @impl true
  def count_shapes(stack_ref) do
    :ets.info(shape_hash_lookup_table(stack_ref), :size)
  end

  @impl true
  def list_shape_handles_for_relations(stack_ref, relations) do
    patterns =
      relations
      |> Enum.map(fn {oid, _} -> {{{oid, :"$1"}, :_}, [], [:"$1"]} end)

    :ets.select(shape_relation_lookup_table(stack_ref), patterns)
  end

  @impl true
  def remove_shape(stack_ref, shape_handle) do
    meta_table = shape_meta_table(stack_ref)

    try do
      shape = :ets.lookup_element(meta_table, shape_handle, @shape_meta_shape_pos)

      # Always delete the hash lookup first, so that we guarantee that no shape spec
      # is ever matched to a handle with incomplete information, since deleting with
      # select_delete can lead to inconsistent state
      :ets.delete(shape_hash_lookup_table(stack_ref), Shape.comparable(shape))

      :ets.delete(meta_table, shape_handle)

      Enum.each(Shape.list_relations(shape), fn {oid, _} ->
        :ets.delete(shape_relation_lookup_table(stack_ref), {oid, shape_handle})
      end)

      :ets.delete(shape_last_used_table(stack_ref), shape_handle)

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

  @impl true
  def reset(stack_ref) do
    :ets.delete_all_objects(shape_hash_lookup_table(stack_ref))
    :ets.delete_all_objects(shape_meta_table(stack_ref))
    :ets.delete_all_objects(shape_relation_lookup_table(stack_ref))
    :ets.delete_all_objects(shape_last_used_table(stack_ref))
    :ok
  end

  @doc """
  Removes all ETS tables associated with the given stack reference.
  Used in tests for tearing down.
  """
  def remove(stack_ref) do
    try(do: :ets.delete(shape_hash_lookup_table(stack_ref)), rescue: (_ in ArgumentError -> :ok))
    try(do: :ets.delete(shape_meta_table(stack_ref)), rescue: (_ in ArgumentError -> :ok))

    try(
      do: :ets.delete(shape_relation_lookup_table(stack_ref)),
      rescue: (_ in ArgumentError -> :ok)
    )

    try(do: :ets.delete(shape_last_used_table(stack_ref)), rescue: (_ in ArgumentError -> :ok))
    :ok
  end

  @impl true
  def get_existing_shape(stack_ref, %Shape{} = shape) do
    case :ets.lookup_element(shape_hash_lookup_table(stack_ref), Shape.comparable(shape), 2, nil) do
      nil ->
        nil

      shape_handle when is_shape_handle(shape_handle) ->
        case latest_offset(stack_ref, shape_handle) do
          {:ok, offset} -> {shape_handle, offset}
          :error -> nil
        end
    end
  end

  @impl true
  def fetch_shape_by_handle(stack_ref, shape_handle) do
    case :ets.lookup_element(
           shape_meta_table(stack_ref),
           shape_handle,
           @shape_meta_shape_pos,
           nil
         ) do
      nil -> :error
      shape -> {:ok, shape}
    end
  end

  @impl true
  def initialise_shape(stack_ref, shape_handle, latest_offset) do
    true =
      :ets.update_element(
        shape_meta_table(stack_ref),
        shape_handle,
        {@shape_meta_latest_offset_pos, latest_offset}
      )

    :ok
  end

  @impl true
  def mark_snapshot_as_started(stack_ref, shape_handle) do
    :ets.update_element(
      shape_meta_table(stack_ref),
      shape_handle,
      {@shape_meta_snapshot_started_pos, true}
    )

    :ok
  end

  @impl true
  def set_latest_offset(stack_ref, shape_handle, latest_offset) do
    :ets.update_element(
      shape_meta_table(stack_ref),
      shape_handle,
      {@shape_meta_latest_offset_pos, latest_offset}
    )

    :ok
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
    :ets.insert(shape_last_used_table(stack_ref), {shape_handle, time})
  end

  def least_recently_used(stack_ref, shape_count) do
    now = System.monotonic_time()
    table = shape_last_used_table(stack_ref)

    # Use :ets.foldl with gb_trees to efficiently maintain top N without copying
    # entire table into memory and without sorting on every iteration
    tree =
      :ets.foldl(
        fn {handle, last_read}, tree ->
          if :gb_trees.size(tree) < shape_count do
            # Insert into the tree until we reach the desired size
            :gb_trees.insert(last_read, handle, tree)
          else
            # If entry being examined was used less recently than the
            # most recently used tracked entry in the tree so far, replace it
            {most_recent_tracked, _handle} = :gb_trees.largest(tree)

            if last_read < most_recent_tracked do
              tree = :gb_trees.delete(most_recent_tracked, tree)
              :gb_trees.insert(last_read, handle, tree)
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
      {last_read, handle, iter} ->
        lru_to_list(iter, [handle | handles], largest_last_read || last_read)

      :none ->
        {handles, largest_last_read}
    end
  end

  def latest_offset!(stack_ref, shape_handle) do
    :ets.lookup_element(
      shape_meta_table(stack_ref),
      shape_handle,
      @shape_meta_latest_offset_pos
    )
  end

  def latest_offset(stack_ref, shape_handle) do
    turn_raise_into_error(fn ->
      :ets.lookup_element(
        shape_meta_table(stack_ref),
        shape_handle,
        @shape_meta_latest_offset_pos
      )
    end)
  end

  @impl true
  def snapshot_started?(stack_ref, shape_handle) do
    :ets.lookup_element(
      shape_meta_table(stack_ref),
      shape_handle,
      @shape_meta_snapshot_started_pos
    )
  rescue
    ArgumentError -> false
  end

  @spec shape_hash_lookup_table(stack_ref()) :: atom()
  defp shape_hash_lookup_table(opts) when is_list(opts) or is_map(opts),
    do: shape_hash_lookup_table(Access.fetch!(opts, :stack_id))

  defp shape_hash_lookup_table(stack_id) when is_stack_id(stack_id),
    do: :"shape_hash_lookup_table:#{stack_id}"

  @spec shape_meta_table(stack_ref()) :: atom()
  defp shape_meta_table(opts) when is_list(opts) or is_map(opts),
    do: shape_meta_table(Access.fetch!(opts, :stack_id))

  defp shape_meta_table(stack_id) when is_stack_id(stack_id),
    do: :"shape_meta_table:#{stack_id}"

  @spec shape_relation_lookup_table(stack_ref()) :: atom()
  defp shape_relation_lookup_table(opts) when is_list(opts) or is_map(opts),
    do: shape_relation_lookup_table(Access.fetch!(opts, :stack_id))

  defp shape_relation_lookup_table(stack_id) when is_stack_id(stack_id),
    do: :"shape_relation_lookup_table:#{stack_id}"

  @spec shape_last_used_table(stack_ref()) :: atom()
  defp shape_last_used_table(opts) when is_list(opts) or is_map(opts),
    do: shape_last_used_table(Access.fetch!(opts, :stack_id))

  defp shape_last_used_table(stack_id) when is_stack_id(stack_id),
    do: :"shape_last_used_table:#{stack_id}"

  defp create_hash_lookup_table(stack_ref) do
    hash_lookup_table = shape_hash_lookup_table(stack_ref)

    :ets.new(hash_lookup_table, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto,
      read_concurrency: true
    ])

    hash_lookup_table
  end

  defp create_meta_table(stack_ref) do
    meta_table = shape_meta_table(stack_ref)

    :ets.new(meta_table, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto,
      read_concurrency: true
    ])

    meta_table
  end

  defp create_relation_lookup_table(stack_ref) do
    relation_lookup_table = shape_relation_lookup_table(stack_ref)

    :ets.new(relation_lookup_table, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto
    ])

    relation_lookup_table
  end

  defp create_last_used_table(stack_ref) do
    last_used_table = shape_last_used_table(stack_ref)

    :ets.new(last_used_table, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto
    ])

    last_used_table
  end

  defp load(stack_ref, storage) do
    _ = Electric.Postgres.supported_types()

    with {:ok, shapes} <- Storage.get_all_stored_shapes(storage) do
      now = System.monotonic_time()

      {hash_lookup_tuples, meta_tuples, last_used_tuples, relation_lookup_tuples} =
        Enum.reduce(
          shapes,
          {[], [], [], []},
          fn {shape_handle, {shape, snapshot_started?}},
             {
               hash_lookup_tuples,
               meta_tuples,
               last_used_tuples,
               relation_lookup_tuples
             } ->
            relations = Shape.list_relations(shape)

            hash_lookup_tuples = [{Shape.comparable(shape), shape_handle} | hash_lookup_tuples]

            meta_tuples =
              [
                {shape_handle, shape, snapshot_started?, LogOffset.last_before_real_offsets()}
                | meta_tuples
              ]

            last_used_tuples = [{shape_handle, now} | last_used_tuples]

            relation_lookup_tuples =
              Enum.map(relations, fn {oid, _} -> {{oid, shape_handle}, nil} end) ++
                relation_lookup_tuples

            {hash_lookup_tuples, meta_tuples, last_used_tuples, relation_lookup_tuples}
          end
        )

      :ets.insert(shape_relation_lookup_table(stack_ref), relation_lookup_tuples)
      :ets.insert(shape_last_used_table(stack_ref), last_used_tuples)
      :ets.insert(shape_meta_table(stack_ref), meta_tuples)
      :ets.insert(shape_hash_lookup_table(stack_ref), hash_lookup_tuples)

      restore_dependency_handles(stack_ref, shapes, storage)

      :ok
    end
  end

  defp restore_dependency_handles(stack_ref, shapes, storage) do
    meta_table = shape_meta_table(stack_ref)

    shapes
    |> Enum.filter(fn {_, {shape, _snapshot_started?}} ->
      Shape.has_dependencies?(shape) and not Shape.dependency_handles_known?(shape)
    end)
    |> Enum.each(fn {handle, {%Shape{shape_dependencies: deps} = shape, _snapshot_started?}} ->
      handles = Enum.map(deps, &get_existing_shape(stack_ref, &1))

      if not Enum.any?(handles, &is_nil/1) do
        handles = Enum.map(handles, &elem(&1, 0))
        shape = %Shape{shape | shape_dependencies_handles: handles}

        :ets.update_element(meta_table, handle, {2, shape})
      else
        Logger.warning("Shape #{inspect(handle)} has dependencies but some are unknown")
        remove_shape(stack_ref, handle)
        Storage.cleanup!(storage, handle)
      end
    end)
  end

  defp store_backup(stack_ref, backup_dir) when is_binary(backup_dir) do
    File.mkdir_p!(backup_dir)
    meta_table = shape_meta_table(stack_ref)
    hash_lookup_table = shape_hash_lookup_table(stack_ref)

    with :ok <-
           :ets.tab2file(
             meta_table,
             backup_file_path(backup_dir, :shape_meta_data),
             sync: true,
             extended_info: [:object_count]
           ),
         :ok <-
           :ets.tab2file(
             hash_lookup_table,
             backup_file_path(backup_dir, :shape_hash_lookup),
             sync: true,
             extended_info: [:object_count]
           ) do
      :ok
    end
  end

  defp load_backup(stack_ref, backup_dir, storage) do
    meta_table = shape_meta_table(stack_ref)
    hash_lookup_table = shape_hash_lookup_table(stack_ref)
    meta_table_path = backup_file_path(backup_dir, :shape_meta_data)
    hash_lookup_table_path = backup_file_path(backup_dir, :shape_hash_lookup)

    result =
      with {:ok, recovered_meta_table} <-
             :ets.file2tab(meta_table_path, verify: true),
           {:ok, recovered_hash_lookup_table} <-
             :ets.file2tab(hash_lookup_table_path, verify: true),
           :ok <- verify_storage_integrity(stack_ref, storage) do
        if recovered_meta_table != meta_table,
          do: :ets.rename(recovered_meta_table, meta_table)

        if recovered_hash_lookup_table != hash_lookup_table,
          do: :ets.rename(recovered_hash_lookup_table, hash_lookup_table)

        last_used_table = create_last_used_table(stack_ref)
        relation_lookup_table = create_relation_lookup_table(stack_ref)

        # repopolate last used table with current time
        :ets.foldl(
          fn {shape_handle, shape, _, _}, _ ->
            :ets.insert(last_used_table, {shape_handle, System.monotonic_time()})

            :ets.insert(
              relation_lookup_table,
              Enum.map(Shape.list_relations(shape), fn {oid, _name} ->
                {{oid, shape_handle}, nil}
              end)
            )
          end,
          :ok,
          meta_table
        )

        :ok
      else
        {:error, reason} ->
          Logger.warning(
            "Failed to restore shape status tables with #{inspect(reason)} - aborting restore"
          )

          try(do: :ets.delete(meta_table), rescue: (_ in ArgumentError -> :ok))
          try(do: :ets.delete(hash_lookup_table), rescue: (_ in ArgumentError -> :ok))
          {:error, reason}
      end

    File.rm_rf(backup_dir)
    result
  end

  defp verify_storage_integrity(stack_ref, storage) do
    with {:ok, stored_handles} <- Storage.get_all_stored_shape_handles(storage) do
      in_memory_handles = stack_ref |> list_shape_handles() |> MapSet.new()

      if MapSet.equal?(in_memory_handles, stored_handles) do
        :ok
      else
        {:error, :storage_integrity_check_failed}
      end
    end
  end

  defp backup_file_path(backup_dir, table_type)
       when table_type in [:shape_hash_lookup, :shape_meta_data] do
    backup_dir |> Path.join("#{table_type}.#{@backup_version}.ets.backup") |> String.to_charlist()
  end

  def backup_dir(storage) do
    case Storage.metadata_backup_dir(storage) do
      nil -> nil
      dir -> Path.join(dir, @backup_dir)
    end
  end

  defp turn_raise_into_error(fun) do
    try do
      {:ok, fun.()}
    rescue
      ArgumentError ->
        :error
    end
  end
end
