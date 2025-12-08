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
  `{condition_id, field, path}` -> `%{keys: [...], condition_id: condition_id | nil}`

  Where `path` is the list of array values traversed to reach this node (e.g., `[]` for root, `[1]`, `[1, 2]`, etc.).

  Additionally, the field type is cached at:
  `{:type, condition_id, field}` -> type
  This enables O(1) type lookup for parsing record values.
  """

  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition

  @env Env.new()

  def add_shape(%Filter{incl_index_table: table} = filter, condition_id, shape_id, optimisation) do
    %{field: field, type: type, value: array_value, and_where: and_where} = optimisation
    :ets.insert(table, {{:type, condition_id, field}, type})

    ordered = array_value |> Enum.sort() |> Enum.dedup()

    add_shape_to_node(filter, table, condition_id, field, [], ordered, shape_id, and_where)
  end

  defp add_shape_to_node(
         filter,
         table,
         condition_id,
         field,
         path,
         [value | values],
         shape_id,
         and_where
       ) do
    # There are still array values left, so don't add the shape to this node
    # Add it to a child or descendant node instead
    node_key = {condition_id, field, path}

    node = get_or_create_node(table, node_key)

    child_path = path ++ [value]
    child_key = {condition_id, field, child_path}

    case :ets.lookup(table, child_key) do
      [] ->
        :ets.insert(table, {child_key, %{keys: [], condition_id: nil}})

        # Update parent's keys list (maintain sorted order)
        updated_keys = insert_sorted(node.keys, value)
        :ets.insert(table, {node_key, %{node | keys: updated_keys}})

      _ ->
        # Child exists, no need to update parent's keys
        :ok
    end

    add_shape_to_node(
      filter,
      table,
      condition_id,
      field,
      child_path,
      values,
      shape_id,
      and_where
    )
  end

  defp add_shape_to_node(filter, table, condition_id, field, path, [], shape_id, and_where) do
    # No more array values left, add the shape to this node
    node_key = {condition_id, field, path}

    node = get_or_create_node(table, node_key)

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

  def remove_shape(%Filter{incl_index_table: table} = filter, condition_id, shape_id, optimisation) do
    %{field: field, value: array_value, and_where: and_where} = optimisation
    ordered = array_value |> Enum.sort() |> Enum.dedup()

    remove_shape_from_node(filter, table, condition_id, field, [], ordered, shape_id, and_where)

    root_key = {condition_id, field, []}

    case :ets.lookup(table, root_key) do
      [{_, root_node}] when root_node.keys == [] and root_node.condition_id == nil ->
        :ets.delete(table, root_key)
        :ets.delete(table, {:type, condition_id, field})
        :deleted

      _ ->
        :ok
    end
  end

  defp remove_shape_from_node(
         filter,
         table,
         condition_id,
         field,
         path,
         [value | values],
         shape_id,
         and_where
       ) do
    # There are still array values left, so don't remove the shape from this node
    # Remove it from a child or descendant node instead
    child_path = path ++ [value]

    remove_shape_from_node(
      filter,
      table,
      condition_id,
      field,
      child_path,
      values,
      shape_id,
      and_where
    )

    child_key = {condition_id, field, child_path}

    case :ets.lookup(table, child_key) do
      [{_, child_node}] ->
        if node_empty?(child_node) do
          :ets.delete(table, child_key)

          node_key = {condition_id, field, path}

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

  defp remove_shape_from_node(filter, table, condition_id, field, path, [], shape_id, and_where) do
    # No more array values left, remove the shape from this node
    node_key = {condition_id, field, path}

    case :ets.lookup(table, node_key) do
      [{_, %{condition_id: nil}}] ->
        :ok

      [{_, %{condition_id: condition_id} = node}] ->
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

  def affected_shapes(%Filter{incl_index_table: table} = filter, condition_id, field, record) do
    case :ets.lookup(table, {:type, condition_id, field}) do
      [] ->
        MapSet.new()

      [{_, type}] ->
        case value_from_record(record, field, type) do
          {:ok, nil} ->
            MapSet.new()

          {:ok, values} when is_list(values) ->
            sorted_values = values |> Enum.sort() |> Enum.dedup()

            shapes_affected_by_tree(
              filter,
              table,
              condition_id,
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

  defp shapes_affected_by_tree(filter, table, condition_id, field, path, values, record) do
    node_key = {condition_id, field, path}

    case :ets.lookup(table, node_key) do
      [] ->
        nil

      [{_, node}] ->
        union(
          shapes_affected_by_node(filter, node, record),
          shapes_affected_by_children(
            filter,
            table,
            condition_id,
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
         condition_id,
         field,
         path,
         [value | keys],
         [value | values],
         record
       ) do
    child_path = path ++ [value]

    union(
      shapes_affected_by_tree(filter, table, condition_id, field, child_path, values, record),
      shapes_affected_by_children(filter, table, condition_id, field, path, keys, values, record)
    )
  end

  # key can be discarded as it's not in the list of values
  defp shapes_affected_by_children(
         filter,
         table,
         condition_id,
         field,
         path,
         [key | keys],
         [value | _] = values,
         record
       )
       when key < value do
    shapes_affected_by_children(filter, table, condition_id, field, path, keys, values, record)
  end

  # value can be discarded as it's not in the list of keys
  defp shapes_affected_by_children(
         filter,
         table,
         condition_id,
         field,
         path,
         keys,
         [_value | values],
         record
       ) do
    shapes_affected_by_children(filter, table, condition_id, field, path, keys, values, record)
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

  def all_shape_ids(%Filter{incl_index_table: table} = filter, condition_id, field) do
    table
    |> :ets.match({{condition_id, field, :_}, :"$1"})
    |> Enum.reduce(MapSet.new(), fn
      [%{condition_id: nil}], ids ->
        ids

      [%{condition_id: condition_id}], ids ->
        MapSet.union(ids, WhereCondition.all_shape_ids(filter, condition_id))
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
