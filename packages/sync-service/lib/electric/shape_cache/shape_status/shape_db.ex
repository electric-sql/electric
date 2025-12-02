defmodule Electric.ShapeCache.ShapeStatus.ShapeDb do
  @moduledoc false

  # Will eventually replace the current ETS lookup tables with a sqlite-backed
  # shape db. Currently just an encapsulation of the shape-to-handle and
  # handle-to-shape ETS lookups.

  alias Electric.Shapes.Shape

  import Electric, only: [is_stack_id: 1]

  @type shape_handle() :: Electric.shape_handle()
  @type stack_id() :: Electric.stack_id()

  # this is called if the load_backup call fails
  def create(stack_id, _version) when is_stack_id(stack_id) do
    Enum.each(tables(stack_id), fn table ->
      create_table(table)
    end)
  end

  @spec load(stack_id(), [{Shape.t(), Shape.comparable(), shape_handle()}]) :: :ok
  def load(stack_id, shape_data) when is_stack_id(stack_id) do
    {handle_lookup_data, shape_lookup_data} =
      Enum.reduce(
        shape_data,
        {[], []},
        fn {shape, comparable, shape_handle}, {handle_lookup_data, shape_lookup_data} ->
          {
            [{comparable, shape_handle} | handle_lookup_data],
            [{shape_handle, shape} | shape_lookup_data]
          }
        end
      )

    :ets.insert(shape_to_handle_table(stack_id), handle_lookup_data)
    :ets.insert(handle_to_shape_table(stack_id), shape_lookup_data)
    :ok
  end

  def add_shape(stack_id, %Shape{} = shape, comparable_shape, shape_handle)
      when is_stack_id(stack_id) do
    true =
      :ets.insert_new(
        shape_to_handle_table(stack_id),
        {comparable_shape, shape_handle}
      )

    true =
      :ets.insert_new(
        handle_to_shape_table(stack_id),
        {shape_handle, shape}
      )

    :ok
  end

  def remove_shape!(stack_id, shape_handle) when is_stack_id(stack_id) do
    handle_to_shape_table = handle_to_shape_table(stack_id)
    shape = :ets.lookup_element(handle_to_shape_table, shape_handle, 2)

    :ets.delete(shape_to_handle_table(stack_id), Shape.comparable(shape))
    :ets.delete(handle_to_shape_table, shape_handle)

    shape
  end

  def update_shape(stack_id, shape_handle, shape) do
    :ets.update_element(handle_to_shape_table(stack_id), shape_handle, {2, shape})
  end

  def handle_for_shape(stack_id, %Shape{} = shape) when is_stack_id(stack_id) do
    :ets.lookup_element(shape_to_handle_table(stack_id), Shape.comparable(shape), 2, nil)
  end

  def shape_for_handle(stack_id, shape_handle) when is_stack_id(stack_id) do
    :ets.lookup_element(handle_to_shape_table(stack_id), shape_handle, 2, nil)
  end

  def list_shapes(stack_id) when is_stack_id(stack_id) do
    stack_id
    |> handle_to_shape_table()
    |> :ets.select([{{:"$1", :"$2"}, [], [{{:"$1", :"$2"}}]}])
  end

  def reduce_shapes(stack_id, acc, reducer_fun) when is_function(reducer_fun, 2) do
    :ets.foldl(
      reducer_fun,
      acc,
      handle_to_shape_table(stack_id)
    )
  end

  # This api is awkward but we don't care because its going
  def store_backup(stack_id, backup_dir, version)
      when is_binary(backup_dir) and is_stack_id(stack_id) do
    with :ok <-
           :ets.tab2file(
             handle_to_shape_table(stack_id),
             backup_file_path(backup_dir, "shape_lookup_data", version),
             sync: true,
             extended_info: [:object_count]
           ),
         :ok <-
           :ets.tab2file(
             shape_to_handle_table(stack_id),
             backup_file_path(backup_dir, "handle_lookup_data", version),
             sync: true,
             extended_info: [:object_count]
           ) do
      :ok
    end
  end

  # this checks for the existance of the table and that the version of any existing
  # file matches the version given
  # if there is no db file or the versions don't match, then return an error which will
  # cause a reset and a fresh load from the storage dirs
  def restore(stack_id, backup_dir, version)
      when is_binary(backup_dir) and is_stack_id(stack_id) do
    with :ok <-
           restore_table(
             handle_to_shape_table(stack_id),
             backup_file_path(backup_dir, "shape_lookup_data", version)
           ),
         :ok <-
           restore_table(
             shape_to_handle_table(stack_id),
             backup_file_path(backup_dir, "handle_lookup_data", version)
           ) do
      :ok
    end
  end

  def delete(stack_id) when is_stack_id(stack_id) do
    Enum.each(tables(stack_id), fn table ->
      try(do: :ets.delete(table), rescue: (_ in ArgumentError -> :ok))
    end)
  end

  def remove(stack_id) when is_stack_id(stack_id) do
    Enum.each(tables(stack_id), fn table ->
      try(do: :ets.delete(table), rescue: (_ in ArgumentError -> :ok))
    end)
  end

  def reset(stack_id) when is_stack_id(stack_id) do
    Enum.each(tables(stack_id), &:ets.delete_all_objects/1)
  end

  defp restore_table(name, path) do
    with {:ok, recovered_table} <- :ets.file2tab(path, verify: true) do
      if recovered_table != name, do: :ets.rename(recovered_table, name)
      :ok
    end
  end

  defp backup_file_path(backup_dir, filename, version) do
    Path.join(backup_dir, "#{filename}.#{version}.ets.backup") |> String.to_charlist()
  end

  defp create_table(name) do
    :ets.new(name, [
      :named_table,
      :public,
      :ordered_set,
      write_concurrency: :auto,
      read_concurrency: true
    ])
  end

  defp tables(stack_id) do
    [
      handle_to_shape_table(stack_id),
      shape_to_handle_table(stack_id)
    ]
  end

  defp handle_to_shape_table(stack_id), do: :"shapedb:shape_lookup:#{stack_id}"
  defp shape_to_handle_table(stack_id), do: :"shapedb:handle_lookup:#{stack_id}"
end
