defmodule Electric.Shapes.Filter.Indexes.InclusionIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `array_field @> const_array` in it.

  The index is a tree stored in ETS. Each node in the tree represents a value in the array.

  When adding a shape to the tree, the shape's array is sorted and deduplicated, then first value is used to find the child node of the root node.
  The child to that node is then found using the next value and so on. When there are no values left, the shape is then added to the last node.
  Adding the shape to the last node is done by adding the shape the node's `WhereCondition` which represents the rest of the where
  clause of the shape (the `@>` comparison may be only part of the where clause) and can also contain many shapes.

  To find the shapes affected by a change, the values of the array in the change are sorted and deduplicated. The tree is then traversed using the values
  and any nodes that contain shapes on the way are added to the result set, because if the node has been reached the shape's array must be a subset of the change's array.

  ## ETS Storage

  Tree nodes are stored in the incl_index_table with keys of the form:
  `{where_cond_id, field, path}` -> `%{keys: [...], condition_id: where_cond_id | nil}`

  Where `path` is the list of array values traversed to reach this node (e.g., `[]` for root, `[1]`, `[1, 2]`, etc.).

  Additionally, the field type is cached at:
  `{:type, where_cond_id, field}` -> type
  This enables O(1) type lookup for parsing record values.
  """

  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition

  @env Env.new()

  @doc """
  Check if the index for a field is empty.
  """
  def empty?(%Filter{incl_index_table: table}, where_cond_id, field) do
    # Check if root node exists and is empty
    root_key = {where_cond_id, field, []}

    case :ets.lookup(table, root_key) do
      [] -> true
      [{_, %{keys: [], condition_id: nil}}] -> true
      [{_, %{keys: []}}] -> true
      _ -> false
    end
  end

  @doc """
  Add a shape to the inclusion index.
  """
  def add_shape(
        %Filter{incl_index_table: table} = filter,
        where_cond_id,
        field,
        type,
        array_value,
        shape_id,
        and_where
      ) do
    # Cache the type for O(1) lookup
    :ets.insert(table, {{:type, where_cond_id, field}, type})

    # Sort and deduplicate the array
    ordered = array_value |> Enum.sort() |> Enum.dedup()

    # Add shape to the tree
    add_shape_to_node(filter, table, where_cond_id, field, [], ordered, shape_id, and_where)
  end

  defp add_shape_to_node(
         filter,
         table,
         where_cond_id,
         field,
         path,
         [value | values],
         shape_id,
         and_where
       ) do
    # There are still array values left, so don't add the shape to this node
    # Add it to a child or descendant node instead
    node_key = {where_cond_id, field, path}

    # Get or create the node
    node = get_or_create_node(table, node_key)

    # Check if child for this value exists
    child_path = path ++ [value]
    child_key = {where_cond_id, field, child_path}

    case :ets.lookup(table, child_key) do
      [] ->
        # Child doesn't exist, create it
        :ets.insert(table, {child_key, %{keys: [], condition_id: nil}})

        # Update parent's keys list (maintain sorted order)
        updated_keys = insert_sorted(node.keys, value)
        :ets.insert(table, {node_key, %{node | keys: updated_keys}})

      _ ->
        # Child exists, no need to update parent's keys
        :ok
    end

    # Recurse to child
    add_shape_to_node(
      filter,
      table,
      where_cond_id,
      field,
      child_path,
      values,
      shape_id,
      and_where
    )
  end

  defp add_shape_to_node(filter, table, where_cond_id, field, path, [], shape_id, and_where) do
    # No more array values left, add the shape to this node
    node_key = {where_cond_id, field, path}

    node = get_or_create_node(table, node_key)

    # Get or create the WhereCondition for this node
    condition_id =
      case node.condition_id do
        nil ->
          new_id = make_ref()
          WhereCondition.init(filter, new_id)
          :ets.insert(table, {node_key, %{node | condition_id: new_id}})
          new_id

        existing_id ->
          existing_id
      end

    # Add shape to the WhereCondition
    WhereCondition.add_shape(filter, condition_id, shape_id, and_where)
  end

  defp get_or_create_node(table, node_key) do
    case :ets.lookup(table, node_key) do
      [] ->
        node = %{keys: [], condition_id: nil}
        :ets.insert(table, {node_key, node})
        node

      [{_, node}] ->
        node
    end
  end

  defp insert_sorted([], value), do: [value]

  defp insert_sorted([head | tail], value) when value < head do
    [value, head | tail]
  end

  defp insert_sorted([head | tail], value) when value == head do
    [head | tail]
  end

  defp insert_sorted([head | tail], value) do
    [head | insert_sorted(tail, value)]
  end

  @doc """
  Remove a shape from the inclusion index.
  """
  def remove_shape(
        %Filter{incl_index_table: table} = filter,
        where_cond_id,
        shape_id,
        field,
        array_value,
        and_where
      ) do
    # Sort and deduplicate the array
    ordered = array_value |> Enum.sort() |> Enum.dedup()

    # Remove shape from the tree
    remove_shape_from_node(filter, table, where_cond_id, field, [], ordered, shape_id, and_where)

    # Clean up root node and type entry if tree is now empty
    root_key = {where_cond_id, field, []}

    case :ets.lookup(table, root_key) do
      [{_, root_node}] when root_node.keys == [] and root_node.condition_id == nil ->
        :ets.delete(table, root_key)
        :ets.delete(table, {:type, where_cond_id, field})

      _ ->
        :ok
    end
  end

  defp remove_shape_from_node(
         filter,
         table,
         where_cond_id,
         field,
         path,
         [value | values],
         shape_id,
         and_where
       ) do
    # There are still array values left, so don't remove the shape from this node
    # Remove it from a child or descendant node instead
    child_path = path ++ [value]

    # Recurse to child
    remove_shape_from_node(
      filter,
      table,
      where_cond_id,
      field,
      child_path,
      values,
      shape_id,
      and_where
    )

    # Check if child is now empty and clean up if so
    child_key = {where_cond_id, field, child_path}

    case :ets.lookup(table, child_key) do
      [{_, child_node}] ->
        if node_empty?(child_node) do
          # Delete the child
          :ets.delete(table, child_key)

          # Update parent's keys list
          node_key = {where_cond_id, field, path}

          case :ets.lookup(table, node_key) do
            [{_, node}] ->
              updated_keys = List.delete(node.keys, value)
              :ets.insert(table, {node_key, %{node | keys: updated_keys}})

            [] ->
              :ok
          end
        end

      [] ->
        :ok
    end
  end

  defp remove_shape_from_node(filter, table, where_cond_id, field, path, [], shape_id, and_where) do
    # No more array values left, remove the shape from this node
    node_key = {where_cond_id, field, path}

    case :ets.lookup(table, node_key) do
      [{_, %{condition_id: nil}}] ->
        :ok

      [{_, %{condition_id: condition_id} = node}] ->
        # Remove shape from the WhereCondition
        case WhereCondition.remove_shape(filter, condition_id, shape_id, and_where) do
          :deleted ->
            :ets.insert(table, {node_key, %{node | condition_id: nil}})

          :ok ->
            :ok
        end

      [] ->
        :ok
    end
  end

  defp node_empty?(%{keys: [], condition_id: nil}), do: true
  defp node_empty?(%{keys: []}), do: true
  defp node_empty?(_), do: false

  @doc """
  Find shapes affected by a record change.
  """
  def affected_shapes(%Filter{incl_index_table: table} = filter, where_cond_id, field, record) do
    case :ets.lookup(table, {:type, where_cond_id, field}) do
      [] ->
        MapSet.new()

      [{_, type}] ->
        case value_from_record(record, field, type) do
          {:ok, nil} ->
            MapSet.new()

          {:ok, values} when is_list(values) ->
            # Sort and deduplicate the array
            sorted_values = values |> Enum.sort() |> Enum.dedup()

            # Traverse the tree
            shapes_affected_by_tree(
              filter,
              table,
              where_cond_id,
              field,
              [],
              sorted_values,
              record
            ) ||
              MapSet.new()

          :error ->
            raise RuntimeError,
              message:
                "Could not parse value for field #{inspect(field)} of type #{inspect(type)}"
        end
    end
  end

  defp shapes_affected_by_tree(filter, table, where_cond_id, field, path, values, record) do
    node_key = {where_cond_id, field, path}

    case :ets.lookup(table, node_key) do
      [] ->
        nil

      [{_, node}] ->
        union(
          shapes_affected_by_node(filter, node, record),
          shapes_affected_by_children(
            filter,
            table,
            where_cond_id,
            field,
            path,
            node.keys,
            values,
            record
          )
        )
    end
  end

  defp shapes_affected_by_node(_filter, %{condition_id: nil}, _record), do: nil

  defp shapes_affected_by_node(filter, %{condition_id: condition_id}, record) do
    WhereCondition.affected_shapes(filter, condition_id, record, fn _shape -> %{} end)
  end

  # key matches value, so check the child then continue with the rest
  defp shapes_affected_by_children(
         filter,
         table,
         where_cond_id,
         field,
         path,
         [value | keys],
         [value | values],
         record
       ) do
    child_path = path ++ [value]

    union(
      shapes_affected_by_tree(filter, table, where_cond_id, field, child_path, values, record),
      shapes_affected_by_children(filter, table, where_cond_id, field, path, keys, values, record)
    )
  end

  # key can be discarded as it's not in the list of values
  defp shapes_affected_by_children(
         filter,
         table,
         where_cond_id,
         field,
         path,
         [key | keys],
         [value | _] = values,
         record
       )
       when key < value do
    shapes_affected_by_children(filter, table, where_cond_id, field, path, keys, values, record)
  end

  # value can be discarded as it's not in the list of keys
  defp shapes_affected_by_children(
         filter,
         table,
         where_cond_id,
         field,
         path,
         keys,
         [_value | values],
         record
       ) do
    shapes_affected_by_children(filter, table, where_cond_id, field, path, keys, values, record)
  end

  # No more keys to process
  defp shapes_affected_by_children(
         _filter,
         _table,
         _where_cond_id,
         _field,
         _path,
         [],
         _values,
         _record
       ),
       do: nil

  # No more values to process
  defp shapes_affected_by_children(
         _filter,
         _table,
         _where_cond_id,
         _field,
         _path,
         _keys,
         [],
         _record
       ),
       do: nil

  defp value_from_record(record, field, type) do
    Env.parse_const(@env, record[field], type)
  end

  @doc """
  Get all shape IDs in this index.
  """
  def all_shape_ids(%Filter{incl_index_table: table} = filter, where_cond_id, field) do
    # Find all node entries with WhereConditions
    pattern = {{where_cond_id, field, :_}, :"$1"}
    entries = :ets.match(table, pattern)

    Enum.reduce(entries, MapSet.new(), fn
      [%{condition_id: nil}], acc ->
        acc

      [%{condition_id: condition_id}], acc ->
        MapSet.union(acc, WhereCondition.all_shape_ids(filter, condition_id))
    end)
  end

  # Union two sets, treating `nil` as an empty set.
  # This allows us to use `nil` rather than `MapSet.new()`
  # and avoid many calls to `MapSet.union/2` which
  # makes `affected_shapes/3` ~20% faster.
  defp union(nil, set), do: set
  defp union(set, nil), do: set
  defp union(set1, set2), do: MapSet.union(set1, set2)
end
