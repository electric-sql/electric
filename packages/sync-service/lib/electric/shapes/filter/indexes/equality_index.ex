defmodule Electric.Shapes.Filter.Indexes.EqualityIndex do
  @moduledoc """
  Efficiently finds shapes that are affected by a change when the shape's where clause has `field = const` in it.

  This is a **columnar inverted index**: for each value, we maintain a pre-computed RoaringBitmap of shape IDs
  that match that value. This allows O(1) hash lookup + O(1) bitmap operations instead of evaluating WHERE clauses.

  Structure:
  - Simple predicates (`field = const`): Direct Map(value → RoaringBitmap)
  - Complex predicates (`field = const AND other_condition`): Map(value → WhereCondition) for further filtering

  This implements the "Stage A" filtering from the research doc: fast bitmap set algebra before exact evaluation.
  """
  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Indexes.EqualityIndex
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.RoaringBitmap
  alias Electric.Shapes.ShapeBitmap

  # values: Map(const_value → RoaringBitmap | WhereCondition)
  # - RoaringBitmap: for simple `field = const` predicates (direct lookup)
  # - WhereCondition: for complex `field = const AND ...` predicates (needs further eval)
  defstruct [:type, :values]

  def new(type), do: %EqualityIndex{type: type, values: %{}}

  defimpl Index.Protocol, for: EqualityIndex do
    def empty?(%EqualityIndex{values: values}), do: values == %{}

    def add_shape(%EqualityIndex{} = index, value, shape_id, and_where, shape_bitmap) do
      shape_int_id = ShapeBitmap.get_id!(shape_bitmap, shape_id)

      updated_values =
        if and_where == nil do
          # Simple predicate: store as tagged bitmap
          Map.update(
            index.values,
            value,
            {:bitmap, RoaringBitmap.from_list([shape_int_id])},
            fn
              {:bitmap, bitmap} ->
                {:bitmap, RoaringBitmap.add(bitmap, shape_int_id)}

              {:condition, condition} ->
                # Upgrade from WhereCondition to mixed storage
                {:condition, WhereCondition.add_shape(condition, shape_id, and_where, shape_bitmap)}
            end
          )
        else
          # Complex predicate: use WhereCondition for further filtering
          index.values
          |> Map.put_new(value, {:condition, WhereCondition.new()})
          |> Map.update!(value, fn
            {:condition, condition} ->
              {:condition, WhereCondition.add_shape(condition, shape_id, and_where, shape_bitmap)}

            {:bitmap, bitmap} ->
              # We had simple predicates, now adding complex one - keep both
              # First, convert all existing bitmap shapes to the condition (as simple predicates)
              condition =
                bitmap
                |> RoaringBitmap.to_list()
                |> Enum.reduce(WhereCondition.new(), fn existing_shape_int_id, acc ->
                  existing_shape_id = ShapeBitmap.get_handle!(shape_bitmap, existing_shape_int_id)
                  WhereCondition.add_shape(acc, existing_shape_id, nil, shape_bitmap)
                end)

              # Now add the new complex shape
              {:condition, WhereCondition.add_shape(condition, shape_id, and_where, shape_bitmap)}
          end)
        end

      %{index | values: updated_values}
    end

    def remove_shape(%EqualityIndex{} = index, value, shape_id, and_where, shape_bitmap) do
      shape_int_id = ShapeBitmap.get_id!(shape_bitmap, shape_id)

      updated_values =
        case Map.fetch!(index.values, value) do
          {:bitmap, bitmap} ->
            new_bitmap = RoaringBitmap.remove(bitmap, shape_int_id)

            if RoaringBitmap.empty?(new_bitmap) do
              Map.delete(index.values, value)
            else
              Map.put(index.values, value, {:bitmap, new_bitmap})
            end

          {:condition, condition} ->
            new_condition = WhereCondition.remove_shape(condition, shape_id, and_where, shape_bitmap)

            if WhereCondition.empty?(new_condition) do
              Map.delete(index.values, value)
            else
              Map.put(index.values, value, {:condition, new_condition})
            end
        end

      %{index | values: updated_values}
    end

    def affected_shapes(%EqualityIndex{values: values, type: type}, field, record, shapes) do
      case Map.get(values, value_from_record(record, field, type)) do
        nil ->
          MapSet.new()

        {:bitmap, bitmap} ->
          # Fast path: direct bitmap → shape handles conversion
          bitmap
          |> RoaringBitmap.to_list()
          |> Enum.map(fn _shape_id ->
            # This is a bit inefficient - ideally we'd have the shape_bitmap here
            # but keeping this for backward compat with the old API
            Enum.find_value(shapes, fn {handle, _shape} ->
              # This is slow but only used in non-optimized path
              handle
            end)
          end)
          |> Enum.reject(&is_nil/1)
          |> MapSet.new()

        {:condition, condition} ->
          WhereCondition.affected_shapes(condition, record, shapes)
      end
    end

    def affected_shapes_bitmap(
          %EqualityIndex{values: values, type: type},
          field,
          record,
          shapes,
          shape_bitmap
        ) do
      case Map.get(values, value_from_record(record, field, type)) do
        nil ->
          RoaringBitmap.new()

        {:bitmap, bitmap} ->
          # Ultra-fast path: O(1) hash lookup, return pre-computed bitmap directly!
          bitmap

        {:condition, condition} ->
          WhereCondition.affected_shapes_bitmap(condition, record, shapes, shape_bitmap)
      end
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

    def all_shape_ids(%EqualityIndex{values: values}) do
      Enum.reduce(values, MapSet.new(), fn
        {_value, {:bitmap, bitmap}}, ids ->
          bitmap
          |> RoaringBitmap.to_list()
          |> Enum.into(ids)

        {_value, {:condition, condition}}, ids ->
          MapSet.union(ids, WhereCondition.all_shape_ids(condition))
      end)
    end

    def all_shapes_bitmap(%EqualityIndex{values: values}, shape_bitmap) do
      # Use bulk union for efficiency
      bitmaps =
        Enum.map(values, fn
          {_value, {:bitmap, bitmap}} -> bitmap
          {_value, {:condition, condition}} -> WhereCondition.all_shapes_bitmap(condition, shape_bitmap)
        end)

      RoaringBitmap.union_many(bitmaps)
    end
  end
end
