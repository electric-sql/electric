defmodule Electric.Shapes.Filter.Indexes.InclusionIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `array_field @> const_array` in it.

  The index is a tree. Each node in the tree represents a value in the array.

  When adding a shape to the tree, the shape's array is sorted and deduplicated, then first value is used to find the child node of the root node.
  The child to that node is then found using the next value and so on. When there are no values left, the shape is then added to the last node.
  Adding the shape to the last node is done by adding the shape the node's `WhereCondition` which represents the rest of the where
  clause of the shape (the `@>` comparison may be only part of the where clause) and can also contain many shapes.

  To find the shapes affected by a change, the values of the array in the change are sorted and deduplicated. The tree is then traversed using the values
  and any nodes that contain shapes on the way are added to the result set, because if the node has been reached the shape's array must be a subset of the change's array.

  A futher optimisation is we keep a sorted list of keys of the children in each node. In `shapes_affected_by_children/3` we have to check the values against the keys.
  We may have more keys or more values, keeping this sorted list of keys allows up to only do min(key_count, value_count) comparisons for the node.
  """
  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Indexes.InclusionIndex
  alias Electric.Shapes.Filter.WhereCondition
  require Logger

  empty_node = %{keys: []}
  @empty_node empty_node

  defstruct [:type, :value_tree]

  def new(type), do: %InclusionIndex{type: type, value_tree: @empty_node}

  defimpl Index.Protocol, for: InclusionIndex do
    @empty_node empty_node

    def empty?(%InclusionIndex{value_tree: value_tree}), do: node_empty?(value_tree)

    def add_shape(%InclusionIndex{} = index, array, {shape_id, shape}, and_where) do
      ordered = array |> Enum.sort() |> Enum.dedup()

      %{
        index
        | value_tree:
            add_shape_to_node(index.value_tree, ordered, %{
              shape_id: shape_id,
              shape: shape,
              and_where: and_where
            })
      }
    end

    defp add_shape_to_node(node, [value | values], shape_info) do
      # There are still array values left so don't add the shape to this node, add it a child or descendent node instead
      case Map.get(node, value) do
        nil ->
          # child for the value does not exist so create one
          child =
            @empty_node
            # add the shape to the child with the remaining values
            |> add_shape_to_node(values, shape_info)

          node
          |> Map.put(value, child)
          # Also add to the sorted list of keys
          # This helps to make `shapes_affected_by_children/3` more efficient
          |> Map.put(:keys, Enum.sort([value | node.keys]))

        child ->
          # Child for the value exists so add the shape to it with the remaining values
          node
          |> Map.put(value, add_shape_to_node(child, values, shape_info))
      end
    end

    defp add_shape_to_node(node, [] = _values, shape_info) do
      # There are no more arry values left so add the shape to the node
      Map.put(
        node,
        :condition,
        WhereCondition.add_shape(
          node[:condition] || WhereCondition.new(),
          {shape_info.shape_id, shape_info.shape},
          shape_info.and_where
        )
      )
    end

    def remove_shape(%InclusionIndex{} = index, shape_id) do
      %{index | value_tree: remove_shape_from_tree(index.value_tree, shape_id)}
    end

    defp remove_shape_from_tree(node, shape_id) do
      node
      |> remove_shape_from_node(shape_id)
      |> remove_shape_from_children(shape_id)
    end

    defp remove_shape_from_node(%{condition: condition} = node, shape_id) do
      condition = WhereCondition.remove_shape(condition, shape_id)

      if condition == WhereCondition.new() do
        Map.delete(node, :condition)
      else
        %{node | condition: condition}
      end
    end

    defp remove_shape_from_node(node, _shape_id), do: node

    defp remove_shape_from_children(node, shape_id) do
      Enum.reduce(node.keys, node, fn key, node ->
        child = remove_shape_from_tree(node[key], shape_id)

        if node_empty?(child) do
          node
          |> Map.delete(key)
          |> Map.put(:keys, List.delete(node.keys, key))
        else
          Map.put(node, key, child)
        end
      end)
    end

    defp node_empty?(%{condition: _}), do: false
    defp node_empty?(%{keys: []}), do: true
    defp node_empty?(_), do: false

    def affected_shapes(%InclusionIndex{} = index, field, record) do
      values =
        record
        |> value_from_record(field, index.type)
        |> Enum.sort()
        |> Enum.dedup()

      shapes_affected_by_tree(index.value_tree, values, record) || MapSet.new()
    end

    defp shapes_affected_by_tree(node, values, record) do
      union(
        shapes_affected_by_node(node, record),
        shapes_affected_by_children(node, values, record)
      )
    end

    defp shapes_affected_by_node(%{condition: condition}, record) do
      WhereCondition.affected_shapes(condition, record)
    end

    defp shapes_affected_by_node(_, _), do: nil

    defp shapes_affected_by_children(%{keys: [value | keys]} = node, [value | values], record) do
      # key matches value, so add the child then continue with the rest of the values
      union(
        shapes_affected_by_tree(node[value], values, record),
        shapes_affected_by_children(%{node | keys: keys}, values, record)
      )
    end

    defp shapes_affected_by_children(%{keys: [key | keys]} = node, [value | _] = values, record)
         when key < value do
      # key can be discarded as it's not in the list of values
      shapes_affected_by_children(%{node | keys: keys}, values, record)
    end

    defp shapes_affected_by_children(node, [_value | values], record) do
      # value can be discarded as it's not in the list of keys
      shapes_affected_by_children(node, values, record)
    end

    defp shapes_affected_by_children(%{keys: []}, _values, _record) do
      # No more keys to process, so no more shapes to find
      nil
    end

    defp shapes_affected_by_children(%{keys: _keys}, [], _record) do
      # No more values to process, so no more shapes to find
      nil
    end

    @env Env.new()
    defp value_from_record(record, field, type) do
      case Env.parse_const(@env, record[field], type) do
        {:ok, value} ->
          value

        :error ->
          raise RuntimeError,
            message: "Could not parse value for field #{inspect(field)} of type #{inspect(type)}"
      end
    end

    def all_shapes(%InclusionIndex{}) do
      # for {_value, condition} <- values,
      #     {shape_id, shape} <- WhereCondition.all_shapes(condition),
      #     into: %{} do
      #   {shape_id, shape}
      # end
    end

    # Union two sets, treating `nil` as an empty set.
    # This allows us to use `nil` rather than `MapSet.new()`
    # and avoid many calls to `MapSet.union/2` which
    # makes `affected_shapes/3` ~20% faster.
    defp union(nil, set), do: set
    defp union(set, nil), do: set
    defp union(set1, set2), do: MapSet.union(set1, set2)
  end
end
