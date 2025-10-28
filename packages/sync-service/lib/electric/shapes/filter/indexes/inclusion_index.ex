defmodule Electric.Shapes.Filter.Indexes.InclusionIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `array_field @> const_array` in it.

  This is a **prefix tree (trie) with pre-computed bitmaps at each node**. Each node represents a sorted array prefix,
  and stores either a RoaringBitmap (for simple predicates) or a WhereCondition (for complex predicates with AND clauses).

  ## Structure

  The index is a tree where each node contains:
  - `:keys` - sorted list of child value keys (for efficient traversal)
  - `:condition` - RoaringBitmap (simple) or WhereCondition (complex) for shapes matching this prefix
  - `value` (as map keys) - child nodes for each array element

  ## Algorithm

  **Adding shapes:**
  1. Sort and deduplicate the shape's array: `[3, 1, 2, 1]` → `[1, 2, 3]`
  2. Traverse tree using each value, creating nodes as needed
  3. At the leaf, store either a RoaringBitmap (if simple predicate) or WhereCondition (if complex)

  **Matching changes:**
  1. Sort and deduplicate the change's array
  2. Traverse tree, collecting all encountered bitmaps (subset matches)
  3. Use bulk bitmap union for O(1) aggregation

  ## Optimization

  This implements **columnar inverted indexing** for array contains operations. For simple predicates,
  we pre-compute bitmaps at each node, allowing O(1) lookup + tree traversal without WHERE clause evaluation.
  """
  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Indexes.InclusionIndex
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.RoaringBitmap
  alias Electric.Shapes.ShapeBitmap

  empty_node = %{keys: []}
  @empty_node empty_node

  defstruct [:type, :value_tree]

  def new(type), do: %InclusionIndex{type: type, value_tree: @empty_node}

  defimpl Index.Protocol, for: InclusionIndex do
    @empty_node empty_node

    def empty?(%InclusionIndex{value_tree: value_tree}), do: node_empty?(value_tree)

    def add_shape(%InclusionIndex{} = index, array, shape_id, and_where, shape_bitmap) do
      ordered = array |> Enum.sort() |> Enum.dedup()

      %{
        index
        | value_tree:
            add_shape_to_node(index.value_tree, ordered, %{
              shape_id: shape_id,
              and_where: and_where,
              shape_bitmap: shape_bitmap
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
      # No more array values - add shape to this node
      shape_int_id = ShapeBitmap.get_id!(shape_info.shape_bitmap, shape_info.shape_id)

      if shape_info.and_where == nil do
        # Simple predicate: store as tagged bitmap
        Map.update(
          node,
          :condition,
          {:bitmap, RoaringBitmap.from_list([shape_int_id])},
          fn
            {:bitmap, bitmap} ->
              {:bitmap, RoaringBitmap.add(bitmap, shape_int_id)}

            {:condition, condition} ->
              # Mixed: keep WhereCondition for complex predicates
              {:condition,
               WhereCondition.add_shape(
                 condition,
                 shape_info.shape_id,
                 shape_info.and_where,
                 shape_info.shape_bitmap
               )}
          end
        )
      else
        # Complex predicate: use WhereCondition
        existing = node[:condition]

        condition =
          case existing do
            {:condition, c} -> c
            nil -> WhereCondition.new()
            _ -> WhereCondition.new()
          end

        Map.put(
          node,
          :condition,
          {:condition,
           WhereCondition.add_shape(
             condition,
             shape_info.shape_id,
             shape_info.and_where,
             shape_info.shape_bitmap
           )}
        )
      end
    end

    def remove_shape(%InclusionIndex{} = index, array, shape_id, and_where, shape_bitmap) do
      ordered = array |> Enum.sort() |> Enum.dedup()

      %{
        index
        | value_tree:
            remove_shape_from_node(index.value_tree, ordered, %{
              shape_id: shape_id,
              and_where: and_where,
              shape_bitmap: shape_bitmap
            })
      }
    end

    defp remove_shape_from_node(node, [value | values], shape_info) do
      # There are still array values left so don't remove the shape from this node, remove it from a child or descendent node instead
      child =
        node
        |> Map.fetch!(value)
        |> remove_shape_from_node(values, shape_info)

      if node_empty?(child) do
        node
        |> Map.delete(value)
        |> Map.put(:keys, List.delete(node.keys, value))
      else
        Map.put(node, value, child)
      end
    end

    defp remove_shape_from_node(node, [] = _values, shape_info) do
      # No more array values - remove shape from this node
      shape_int_id = ShapeBitmap.get_id!(shape_info.shape_bitmap, shape_info.shape_id)

      case node[:condition] do
        {:bitmap, bitmap} ->
          new_bitmap = RoaringBitmap.remove(bitmap, shape_int_id)

          if RoaringBitmap.empty?(new_bitmap) do
            Map.delete(node, :condition)
          else
            Map.put(node, :condition, {:bitmap, new_bitmap})
          end

        {:condition, condition} ->
          new_condition =
            WhereCondition.remove_shape(
              condition,
              shape_info.shape_id,
              shape_info.and_where,
              shape_info.shape_bitmap
            )

          if WhereCondition.empty?(new_condition) do
            Map.delete(node, :condition)
          else
            Map.put(node, :condition, {:condition, new_condition})
          end

        nil ->
          node
      end
    end

    defp node_empty?(%{condition: {:bitmap, _}}), do: false
    defp node_empty?(%{condition: {:condition, _}}), do: false
    defp node_empty?(%{keys: []}), do: true
    defp node_empty?(_), do: false

    def affected_shapes(%InclusionIndex{} = index, field, record, shapes) do
      record
      |> value_from_record(field, index.type)
      |> shapes_affected_by_array(index, record, shapes)
    end

    defp shapes_affected_by_array(nil, _, _, _), do: MapSet.new()

    defp shapes_affected_by_array(values, index, record, shapes) when is_list(values) do
      values =
        values
        |> Enum.sort()
        |> Enum.dedup()

      shapes_affected_by_tree(index.value_tree, values, record, shapes) || MapSet.new()
    end

    defp shapes_affected_by_tree(node, values, record, shapes) do
      union(
        shapes_affected_by_node(node, record, shapes),
        shapes_affected_by_children(node, values, record, shapes)
      )
    end

    defp shapes_affected_by_node(%{condition: {:bitmap, bitmap}}, _record, shapes) do
      # Fast path: direct bitmap → MapSet conversion
      # (This is inefficient due to needing shape_bitmap, but kept for backward compat)
      bitmap
      |> RoaringBitmap.to_list()
      |> Enum.map(fn shape_id ->
        Enum.find_value(shapes, fn {handle, _shape} -> handle end)
      end)
      |> Enum.reject(&is_nil/1)
      |> MapSet.new()
    end

    defp shapes_affected_by_node(%{condition: {:condition, condition}}, record, shapes) do
      WhereCondition.affected_shapes(condition, record, shapes)
    end

    defp shapes_affected_by_node(_, _, _), do: nil

    defp shapes_affected_by_children(
           %{keys: [value | keys]} = node,
           [value | values],
           record,
           shapes
         ) do
      # key matches value, so add the child then continue with the rest of the values
      union(
        shapes_affected_by_tree(node[value], values, record, shapes),
        shapes_affected_by_children(%{node | keys: keys}, values, record, shapes)
      )
    end

    defp shapes_affected_by_children(
           %{keys: [key | keys]} = node,
           [value | _] = values,
           record,
           shapes
         )
         when key < value do
      # key can be discarded as it's not in the list of values
      shapes_affected_by_children(%{node | keys: keys}, values, record, shapes)
    end

    defp shapes_affected_by_children(node, [_value | values], record, shapes) do
      # value can be discarded as it's not in the list of keys
      shapes_affected_by_children(node, values, record, shapes)
    end

    defp shapes_affected_by_children(%{keys: []}, _values, _record, _shapes) do
      # No more keys to process, so no more shapes to find
      nil
    end

    defp shapes_affected_by_children(%{keys: _keys}, [], _record, _shapes) do
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

    def all_shape_ids(%InclusionIndex{value_tree: value_tree}), do: shape_ids_in_tree(value_tree)

    defp shape_ids_in_tree(node) do
      Map.merge(shape_ids_in_node(node), shape_ids_in_children(node))
    end

    defp shape_ids_in_node(%{condition: {:bitmap, bitmap}}) do
      bitmap
      |> RoaringBitmap.to_list()
      |> MapSet.new()
    end

    defp shape_ids_in_node(%{condition: {:condition, condition}}) do
      WhereCondition.all_shape_ids(condition)
    end

    defp shape_ids_in_node(_), do: MapSet.new()

    defp shape_ids_in_children(node) do
      Enum.reduce(node.keys, %{}, fn key, shapes ->
        Map.merge(shapes, shape_ids_in_tree(node[key]))
      end)
    end

    # Bitmap versions of the above functions
    def affected_shapes_bitmap(%InclusionIndex{} = index, field, record, shapes, shape_bitmap) do
      record
      |> value_from_record(field, index.type)
      |> shapes_affected_by_array_bitmap(index, record, shapes, shape_bitmap)
    end

    defp shapes_affected_by_array_bitmap(nil, _, _, _, _), do: RoaringBitmap.new()

    defp shapes_affected_by_array_bitmap(values, index, record, shapes, shape_bitmap)
         when is_list(values) do
      values =
        values
        |> Enum.sort()
        |> Enum.dedup()

      shapes_affected_by_tree_bitmap(index.value_tree, values, record, shapes, shape_bitmap) ||
        RoaringBitmap.new()
    end

    defp shapes_affected_by_tree_bitmap(node, values, record, shapes, shape_bitmap) do
      union_bitmap(
        shapes_affected_by_node_bitmap(node, record, shapes, shape_bitmap),
        shapes_affected_by_children_bitmap(node, values, record, shapes, shape_bitmap)
      )
    end

    defp shapes_affected_by_node_bitmap(
           %{condition: {:bitmap, bitmap}},
           _record,
           _shapes,
           _shape_bitmap
         ) do
      # Ultra-fast path: return pre-computed bitmap directly!
      # No WHERE clause evaluation needed
      bitmap
    end

    defp shapes_affected_by_node_bitmap(
           %{condition: {:condition, condition}},
           record,
           shapes,
           shape_bitmap
         ) do
      WhereCondition.affected_shapes_bitmap(condition, record, shapes, shape_bitmap)
    end

    defp shapes_affected_by_node_bitmap(_, _, _, _), do: nil

    defp shapes_affected_by_children_bitmap(
           %{keys: [value | keys]} = node,
           [value | values],
           record,
           shapes,
           shape_bitmap
         ) do
      # key matches value, so add the child then continue with the rest of the values
      union_bitmap(
        shapes_affected_by_tree_bitmap(node[value], values, record, shapes, shape_bitmap),
        shapes_affected_by_children_bitmap(%{node | keys: keys}, values, record, shapes, shape_bitmap)
      )
    end

    defp shapes_affected_by_children_bitmap(
           %{keys: [key | keys]} = node,
           [value | _] = values,
           record,
           shapes,
           shape_bitmap
         )
         when key < value do
      # key can be discarded as it's not in the list of values
      shapes_affected_by_children_bitmap(%{node | keys: keys}, values, record, shapes, shape_bitmap)
    end

    defp shapes_affected_by_children_bitmap(node, [_value | values], record, shapes, shape_bitmap) do
      # value can be discarded as it's not in the list of keys
      shapes_affected_by_children_bitmap(node, values, record, shapes, shape_bitmap)
    end

    defp shapes_affected_by_children_bitmap(%{keys: []}, _values, _record, _shapes, _shape_bitmap) do
      # No more keys to process, so no more shapes to find
      nil
    end

    defp shapes_affected_by_children_bitmap(%{keys: _keys}, [], _record, _shapes, _shape_bitmap) do
      # No more values to process, so no more shapes to find
      nil
    end

    def all_shapes_bitmap(%InclusionIndex{value_tree: value_tree}, shape_bitmap) do
      shape_ids_in_tree_bitmap(value_tree, shape_bitmap)
    end

    defp shape_ids_in_tree_bitmap(node, shape_bitmap) do
      RoaringBitmap.union(
        shape_ids_in_node_bitmap(node, shape_bitmap),
        shape_ids_in_children_bitmap(node, shape_bitmap)
      )
    end

    defp shape_ids_in_node_bitmap(%{condition: {:bitmap, bitmap}}, _shape_bitmap) do
      # Fast path: bitmap already pre-computed
      bitmap
    end

    defp shape_ids_in_node_bitmap(%{condition: {:condition, condition}}, shape_bitmap) do
      WhereCondition.all_shapes_bitmap(condition, shape_bitmap)
    end

    defp shape_ids_in_node_bitmap(_, _), do: RoaringBitmap.new()

    defp shape_ids_in_children_bitmap(node, shape_bitmap) do
      Enum.reduce(node.keys, RoaringBitmap.new(), fn key, bitmap ->
        RoaringBitmap.union(bitmap, shape_ids_in_tree_bitmap(node[key], shape_bitmap))
      end)
    end

    # Union two sets, treating `nil` as an empty set.
    # This allows us to use `nil` rather than `MapSet.new()`
    # and avoid many calls to `MapSet.union/2` which
    # makes `affected_shapes/3` ~20% faster.
    defp union(nil, set), do: set
    defp union(set, nil), do: set
    defp union(set1, set2), do: MapSet.union(set1, set2)

    # Union for bitmaps, treating `nil` as an empty bitmap
    defp union_bitmap(nil, bitmap), do: bitmap
    defp union_bitmap(bitmap, nil), do: bitmap
    defp union_bitmap(bitmap1, bitmap2), do: RoaringBitmap.union(bitmap1, bitmap2)
  end
end
