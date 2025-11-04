defmodule Electric.ShapeCache.ShapeStatusBehaviour do
  @moduledoc """
  Behaviour defining the ShapeStatus functions to be used in mocks
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
  @callback terminate(stack_ref(), String.t()) :: :ok | {:error, term()}
  @callback list_shapes(stack_ref()) :: [{shape_handle(), Shape.t()}]
  @callback count_shapes(stack_ref()) :: non_neg_integer()
  @callback get_existing_shape(stack_ref(), Shape.t() | shape_handle()) ::
              {shape_handle(), LogOffset.t()} | nil
  @callback fetch_shape_by_handle(stack_ref(), shape_handle()) :: {:ok, Shape.t()} | :error
  @callback add_shape(stack_ref(), Shape.t()) :: {:ok, shape_handle()} | {:error, term()}
  @callback initialise_shape(stack_ref(), shape_handle(), xmin(), LogOffset.t()) :: :ok
  @callback set_snapshot_xmin(stack_ref(), shape_handle(), xmin()) :: :ok
  @callback set_latest_offset(stack_ref(), shape_handle(), LogOffset.t()) :: :ok
  @callback mark_snapshot_started(stack_ref(), shape_handle()) :: :ok
  @callback snapshot_started?(stack_ref(), shape_handle()) :: boolean()
  @callback remove_shape(stack_ref(), shape_handle()) :: {:ok, Shape.t()} | {:error, term()}
  @callback reset(stack_ref()) :: :ok

  @callback set_shape_storage_state(stack_ref(), shape_handle(), term()) :: :ok
  @callback consume_shape_storage_state(stack_ref(), shape_handle()) :: term() | nil

  @callback shape_meta_table(stack_ref()) :: atom()
  @callback shape_last_used_table(stack_ref()) :: atom()
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

  require Logger

  @behaviour Electric.ShapeCache.ShapeStatusBehaviour

  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()
  @type table() :: atom() | reference()
  @type t() :: Keyword.t() | binary() | atom()

  @table_version "v1"
  @backup_dir "shape_status_backups"
  @backup_file "shape_status_#{@table_version}.ets.backup"

  @shape_meta_data :shape_meta_data
  @shape_hash_lookup :shape_hash_lookup
  @shape_relation_lookup :shape_relation_lookup
  @shape_storage_state_backup :shape_storage_state_backup
  @shape_meta_shape_pos 2
  @shape_meta_xmin_pos 3
  @shape_meta_latest_offset_pos 4
  @snapshot_started :snapshot_started

  @impl true
  def initialize_from_storage(stack_ref, storage) do
    last_used_table = create_last_used_table(stack_ref)
    meta_table = shape_meta_table(stack_ref)

    case load_table_backup(meta_table, storage) do
      {:ok, ^meta_table, path} ->
        Logger.info("Loaded shape status from backup at #{path}")
        :ok

      _ ->
        Logger.debug("No shape status backup loaded, creating new table #{meta_table}")
        create_meta_table(stack_ref)
        load(meta_table, last_used_table, storage)
    end
  end

  def initialize_empty(stack_ref) do
    create_last_used_table(stack_ref)
    create_meta_table(stack_ref)
  end

  @impl true
  def terminate(stack_ref, backup_dir) do
    meta_table = shape_meta_table(stack_ref)
    store_table_backup(meta_table, backup_dir)
  end

  @impl true
  def add_shape(stack_ref, shape) do
    {_, shape_handle} = Shape.generate_id(shape)
    # For fresh snapshots we're setting "latest" offset to be a highest possible virtual offset,
    # which is needed because while the snapshot is being made we DON'T update this ETS table.
    # We could, but that would required making the Storage know about this module and I don't like that.
    offset = LogOffset.last_before_real_offsets()

    true =
      :ets.insert_new(
        shape_meta_table(stack_ref),
        [
          {{@shape_hash_lookup, Shape.comparable(shape)}, shape_handle},
          {{@shape_meta_data, shape_handle}, shape, nil, offset}
          | Enum.map(Shape.list_relations(shape), fn {oid, _name} ->
              {{@shape_relation_lookup, oid, shape_handle}, true}
            end)
        ]
      )

    true =
      :ets.insert_new(shape_last_used_table(stack_ref), [
        {shape_handle, System.monotonic_time()}
      ])

    {:ok, shape_handle}
  end

  @impl true
  def list_shapes(stack_ref) do
    shape_meta_table(stack_ref)
    |> :ets.select([
      {
        {{@shape_meta_data, :"$1"}, :"$2", :_, :_},
        [],
        [{{:"$1", :"$2"}}]
      }
    ])
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

  @impl true
  def count_shapes(stack_ref) do
    :ets.info(shape_last_used_table(stack_ref), :size)
  end

  @spec list_shape_handles_for_relations(t(), list(Electric.oid_relation())) :: [
          shape_handle()
        ]
  def list_shape_handles_for_relations(stack_ref, relations) do
    patterns =
      relations
      |> Enum.map(fn {oid, _} -> {{@shape_relation_lookup, oid, :"$1"}, :_} end)
      |> Enum.map(fn match -> {match, [true], [:"$1"]} end)

    :ets.select(shape_meta_table(stack_ref), patterns)
  end

  @impl true
  def remove_shape(stack_ref, shape_handle) do
    meta_table = shape_meta_table(stack_ref)

    try do
      shape =
        :ets.lookup_element(
          meta_table,
          {@shape_meta_data, shape_handle},
          @shape_meta_shape_pos
        )

      # Always delete the hash lookup first, so that we guarantee that no shape spec
      # is ever matched to a handle with incomplete information, since deleting with
      # select_delete can lead to inconsistent state
      :ets.delete(meta_table, {@shape_hash_lookup, Shape.comparable(shape)})

      :ets.delete(meta_table, {@shape_meta_data, shape_handle})

      :ets.delete(meta_table, {@shape_storage_state_backup, shape_handle})

      :ets.delete(meta_table, {@snapshot_started, shape_handle})

      Enum.each(Shape.list_relations(shape), fn {oid, _} ->
        :ets.delete(meta_table, {@shape_relation_lookup, oid, shape_handle})
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
    :ets.delete_all_objects(shape_meta_table(stack_ref))
    :ets.delete_all_objects(shape_last_used_table(stack_ref))
    :ok
  end

  @impl true
  def get_existing_shape(stack_ref, %Shape{} = shape) do
    case :ets.lookup_element(
           shape_meta_table(stack_ref),
           {@shape_hash_lookup, Shape.comparable(shape)},
           2,
           nil
         ) do
      nil -> nil
      shape_handle when is_binary(shape_handle) -> get_existing_shape(stack_ref, shape_handle)
    end
  end

  def get_existing_shape(stack_ref, shape_handle) when is_binary(shape_handle) do
    case :ets.lookup_element(
           shape_meta_table(stack_ref),
           {@shape_meta_data, shape_handle},
           @shape_meta_latest_offset_pos,
           nil
         ) do
      nil -> nil
      offset -> {shape_handle, offset}
    end
  end

  @impl true
  def fetch_shape_by_handle(stack_ref, shape_handle) do
    case :ets.lookup_element(
           shape_meta_table(stack_ref),
           {@shape_meta_data, shape_handle},
           @shape_meta_shape_pos,
           nil
         ) do
      nil -> :error
      shape -> {:ok, shape}
    end
  end

  @impl true
  def initialise_shape(stack_ref, shape_handle, snapshot_xmin, latest_offset) do
    true =
      :ets.update_element(
        shape_meta_table(stack_ref),
        {@shape_meta_data, shape_handle},
        [
          {@shape_meta_xmin_pos, snapshot_xmin},
          {@shape_meta_latest_offset_pos, latest_offset}
        ]
      )

    :ok
  end

  @impl true
  def set_snapshot_xmin(stack_ref, shape_handle, snapshot_xmin) do
    :ets.update_element(shape_meta_table(stack_ref), {@shape_meta_data, shape_handle}, [
      {@shape_meta_xmin_pos, snapshot_xmin}
    ])

    :ok
  end

  @impl true
  def set_latest_offset(stack_ref, shape_handle, latest_offset) do
    :ets.update_element(shape_meta_table(stack_ref), {@shape_meta_data, shape_handle}, [
      {@shape_meta_latest_offset_pos, latest_offset}
    ])

    :ok
  end

  def update_last_read_time_to_now(stack_ref, shape_handle) do
    :ets.insert(shape_last_used_table(stack_ref), {shape_handle, System.monotonic_time()})
  end

  def least_recently_used(stack_ref, shape_count) do
    :ets.tab2list(shape_last_used_table(stack_ref))
    |> Enum.sort_by(fn {_handle, last_read} -> last_read end)
    |> Stream.map(fn {handle, last_read} ->
      %{
        shape_handle: handle,
        elapsed_minutes_since_use:
          System.convert_time_unit(System.monotonic_time() - last_read, :native, :second) / 60
      }
    end)
    |> Enum.take(shape_count)
  end

  def latest_offset!(stack_ref, shape_handle) do
    :ets.lookup_element(
      shape_meta_table(stack_ref),
      {@shape_meta_data, shape_handle},
      @shape_meta_latest_offset_pos
    )
  end

  def latest_offset(stack_ref, shape_handle) do
    turn_raise_into_error(fn ->
      :ets.lookup_element(
        shape_meta_table(stack_ref),
        {@shape_meta_data, shape_handle},
        @shape_meta_latest_offset_pos
      )
    end)
  end

  def snapshot_xmin(stack_ref, shape_handle) do
    turn_raise_into_error(fn ->
      :ets.lookup_element(
        shape_meta_table(stack_ref),
        {@shape_meta_data, shape_handle},
        @shape_meta_xmin_pos
      )
    end)
  end

  @impl true
  def snapshot_started?(stack_ref, shape_handle) do
    case :ets.lookup(shape_meta_table(stack_ref), {@snapshot_started, shape_handle}) do
      [] -> false
      [{{@snapshot_started, ^shape_handle}, started?}] -> started?
    end
  end

  @impl true
  def mark_snapshot_started(stack_ref, shape_handle) do
    :ets.insert(shape_meta_table(stack_ref), {{@snapshot_started, shape_handle}, true})
    :ok
  end

  @impl true
  def set_shape_storage_state(stack_ref, shape_handle, storage_state) do
    :ets.insert(
      shape_meta_table(stack_ref),
      {{@shape_storage_state_backup, shape_handle}, storage_state}
    )

    :ok
  end

  @impl true
  def consume_shape_storage_state(stack_ref, shape_handle) do
    meta_table = shape_meta_table(stack_ref)
    res = :ets.lookup_element(meta_table, {@shape_storage_state_backup, shape_handle}, 2)
    :ets.delete(meta_table, {@shape_storage_state_backup, shape_handle})
    res
  rescue
    ArgumentError -> nil
  end

  @impl true
  def shape_meta_table(table) when is_atom(table), do: table
  def shape_meta_table(opts) when is_list(opts), do: shape_meta_table(opts[:stack_id])
  def shape_meta_table(stack_id) when is_binary(stack_id), do: :"#{stack_id}:shape_meta_table"

  if Mix.env() == :test do
    def shape_meta_table(state) when is_map(state), do: state.shape_meta_table
  end

  @impl true
  def shape_last_used_table(table) when is_atom(table), do: table
  def shape_last_used_table(opts) when is_list(opts), do: shape_last_used_table(opts[:stack_id])

  def shape_last_used_table(stack_id) when is_binary(stack_id),
    do: :"#{stack_id}:shape_last_used_table"

  if Mix.env() == :test do
    def shape_last_used_table(state) when is_map(state), do: state.shape_last_used_table
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

  defp create_meta_table(stack_ref) do
    meta_table = shape_meta_table(stack_ref)

    :ets.new(meta_table, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto
    ])

    meta_table
  end

  defp load(meta_table, last_used_table, storage) do
    _ = Electric.Postgres.supported_types()

    with {:ok, shapes} <- Storage.get_all_stored_shapes(storage) do
      now = System.monotonic_time()

      {meta_tuples, last_used_tuples} =
        Enum.flat_map_reduce(shapes, [], fn {shape_handle, {shape, snapshot_started?}},
                                            last_used_tuples ->
          relations = Shape.list_relations(shape)

          meta_tuples =
            [
              {{@shape_hash_lookup, Shape.comparable(shape)}, shape_handle},
              {{@shape_meta_data, shape_handle}, shape, nil, LogOffset.first()},
              {{@snapshot_started, shape_handle}, snapshot_started?}
              | Enum.map(relations, fn {oid, _} ->
                  {{@shape_relation_lookup, oid, shape_handle}, true}
                end)
            ]

          last_used_tuples = [{shape_handle, now} | last_used_tuples]

          {meta_tuples, last_used_tuples}
        end)

      :ets.insert(meta_table, meta_tuples)
      :ets.insert(last_used_table, last_used_tuples)

      restore_dependency_handles(shapes, meta_table, storage)

      :ok
    end
  end

  defp restore_dependency_handles(shapes, meta_table, storage) do
    shapes
    |> Enum.filter(fn {_, {shape, _snapshot_started?}} ->
      Shape.has_dependencies?(shape) and not Shape.dependency_handles_known?(shape)
    end)
    |> Enum.each(fn {handle, {%Shape{shape_dependencies: deps} = shape, _snapshot_started?}} ->
      handles = Enum.map(deps, &get_existing_shape(meta_table, &1))

      if not Enum.any?(handles, &is_nil/1) do
        handles = Enum.map(handles, &elem(&1, 0))
        shape = %Shape{shape | shape_dependencies_handles: handles}

        :ets.update_element(meta_table, {@shape_meta_data, handle}, {2, shape})
      else
        Logger.warning("Shape #{inspect(handle)} has dependencies but some are unknown")
        remove_shape(meta_table, handle)
        Storage.cleanup!(storage, handle)
      end
    end)
  end

  defp store_table_backup(meta_table, backup_dir) do
    case backup_dir do
      nil ->
        :ok

      backup_dir ->
        File.mkdir_p!(backup_dir)

        :ets.tab2file(
          meta_table,
          backup_file_path(backup_dir),
          sync: true,
          extended_info: [:object_count]
        )
    end
  end

  defp load_table_backup(meta_table, storage) do
    case backup_dir(storage) do
      nil ->
        {:error, :no_backup_dir}

      backup_dir ->
        path = backup_file_path(backup_dir)

        result =
          case :ets.file2tab(path, verify: true) do
            {:ok, recovered_table} ->
              if recovered_table != meta_table, do: :ets.rename(recovered_table, meta_table)

              case verify_storage_integrity(meta_table, storage) do
                :ok ->
                  {:ok, meta_table, path}

                {:error, reason} ->
                  Logger.warning(
                    "Loaded shape status backup but failed integrity check with #{inspect(reason)} - aborting restore"
                  )

                  :ets.delete(meta_table)
                  {:error, reason}
              end

            {:error, reason} ->
              {:error, reason}
          end

        File.rm_rf(backup_dir)
        result
    end
  end

  defp verify_storage_integrity(meta_table, storage) do
    with {:ok, stored_handles} <- Storage.get_all_stored_shape_handles(storage) do
      in_memory_handles = list_shapes(meta_table) |> Enum.map(&elem(&1, 0)) |> MapSet.new()

      if MapSet.equal?(in_memory_handles, stored_handles) do
        :ok
      else
        {:error, :storage_integrity_check_failed}
      end
    end
  end

  defp backup_file_path(backup_dir) do
    backup_dir |> Path.join(@backup_file) |> String.to_charlist()
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
