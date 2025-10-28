defmodule Electric.Shapes.Filter do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change.

  `affected_shapes(filter, change)` will return a set of IDs for the shapes that are affected by the change
  considering all the shapes that have been added to the filter using `add_shape/3`.


  The `Filter` module keeps track of what tables are referenced by the shapes and changes and delegates
  the table specific logic to the `Filter.WhereCondition` module.
  """

  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.RoaringBitmap
  alias Electric.Shapes.Shape
  alias Electric.Shapes.ShapeBitmap
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defstruct tables: %{}, refs_fun: nil, shapes: %{}, shape_bitmap: %ShapeBitmap{}

  @type t :: %Filter{}
  @type shape_id :: any()

  @spec new(keyword()) :: Filter.t()
  def new(opts \\ []) do
    %Filter{refs_fun: Keyword.get(opts, :refs_fun, fn _shape -> %{} end)}
  end

  @spec has_shape?(t(), shape_id()) :: boolean()
  def has_shape?(%Filter{} = filter, shape_handle) do
    is_map_key(filter.shapes, shape_handle)
  end

  @spec active_shapes(t()) :: [shape_id()]
  def active_shapes(%Filter{} = filter) do
    Map.keys(filter.shapes)
  end

  @doc """
  Add a shape for the filter to track.

  The `shape_id` can be any term you like to identify the shape. Whatever you use will be returned
  by `affected_shapes/2` when the shape is affected by a change.
  """
  @spec add_shape(Filter.t(), shape_id(), Shape.t()) :: Filter.t()
  def add_shape(%Filter{} = filter, shape_id, shape) do
    if has_shape?(filter, shape_id), do: raise("duplicate shape #{shape_id}")

    # Add shape to bitmap mapping
    {shape_bitmap, _integer_id} = ShapeBitmap.add_shape(filter.shape_bitmap, shape_id)

    %Filter{
      filter
      | tables:
          Map.update(
            filter.tables,
            shape.root_table,
            WhereCondition.add_shape(WhereCondition.new(), shape_id, shape.where, shape_bitmap),
            fn condition ->
              WhereCondition.add_shape(condition, shape_id, shape.where, shape_bitmap)
            end
          ),
        shapes: Map.put(filter.shapes, shape_id, shape),
        shape_bitmap: shape_bitmap
    }
  end

  @doc """
  Remove a shape from the filter.
  """
  @spec remove_shape(Filter.t(), shape_id()) :: Filter.t()
  def remove_shape(%Filter{} = filter, shape_id) do
    shape = Map.fetch!(filter.shapes, shape_id)

    # Remove shape from bitmap mapping
    {shape_bitmap, _freed_id} = ShapeBitmap.remove_shape(filter.shape_bitmap, shape_id)

    condition =
      Map.fetch!(filter.tables, shape.root_table)
      |> WhereCondition.remove_shape(shape_id, shape.where, shape_bitmap)

    tables =
      if WhereCondition.empty?(condition) do
        Map.delete(filter.tables, shape.root_table)
      else
        Map.put(filter.tables, shape.root_table, condition)
      end

    %Filter{
      filter
      | tables: tables,
        shapes: Map.delete(filter.shapes, shape_id),
        shape_bitmap: shape_bitmap
    }
  end

  @doc """
  Returns the shape IDs for all shapes that have been added to the filter
  that are affected by the given change.

  Returns a MapSet for backward compatibility, but uses RoaringBitmaps internally for performance.
  """
  @spec affected_shapes(Filter.t(), Transaction.t() | Relation.t()) :: MapSet.t(shape_id())
  def affected_shapes(%Filter{} = filter, change) do
    OpenTelemetry.timed_fun("filter.affected_shapes.duration_µs", fn ->
      try do
        shapes_affected_by_change(filter, change)
      rescue
        error ->
          Logger.error("""
          Unexpected error in Filter.affected_shapes:
          #{Exception.format(:error, error, __STACKTRACE__)}
          """)

          OpenTelemetry.record_exception(:error, error, __STACKTRACE__)

          # We can't tell which shapes are affected, the safest thing to do is return all shapes
          all_shape_ids(filter)
      end
    end)
  end

  @doc """
  Returns a RoaringBitmap of shape IDs affected by the given change.

  This is the optimized version that avoids MapSet conversions. Use this internally
  for maximum performance.
  """
  @spec affected_shapes_bitmap(Filter.t(), Transaction.t() | Relation.t()) :: RoaringBitmap.t()
  def affected_shapes_bitmap(%Filter{} = filter, change) do
    OpenTelemetry.timed_fun("filter.affected_shapes.duration_µs", fn ->
      try do
        shapes_affected_by_change_bitmap(filter, change)
      rescue
        error ->
          Logger.error("""
          Unexpected error in Filter.affected_shapes_bitmap:
          #{Exception.format(:error, error, __STACKTRACE__)}
          """)

          OpenTelemetry.record_exception(:error, error, __STACKTRACE__)

          # We can't tell which shapes are affected, return all shapes
          ShapeBitmap.all_shapes_bitmap(filter.shape_bitmap)
      end
    end)
  end

  defp shapes_affected_by_change(%Filter{} = filter, %Relation{} = relation) do
    # Check all shapes is all tables because the table may have been renamed
    for shape_id <- all_shape_ids(filter),
        shape = Map.fetch!(filter.shapes, shape_id),
        Shape.is_affected_by_relation_change?(shape, relation),
        into: MapSet.new() do
      shape_id
    end
  end

  defp shapes_affected_by_change(%Filter{} = filter, %Transaction{changes: changes}) do
    # Use bitmap version internally, convert to MapSet only at the end
    bitmap = shapes_affected_by_change_bitmap(filter, %Transaction{changes: changes})
    ShapeBitmap.to_handles(filter.shape_bitmap, bitmap)
  end

  defp shapes_affected_by_change_bitmap(%Filter{} = filter, %Transaction{changes: changes}) do
    # Collect all bitmaps from changes
    bitmaps =
      Enum.map(changes, fn change ->
        shapes_affected_by_change_bitmap_single(filter, change)
      end)

    # Bulk union: single NIF call for entire transaction
    RoaringBitmap.union_many(bitmaps)
  end

  defp shapes_affected_by_change_bitmap_single(filter, change) do
    case change do
      %Relation{} = relation ->
        # For relations, we need to check all shapes (can't optimize with bitmaps)
        shapes =
          for shape_id <- ShapeBitmap.all_handles(filter.shape_bitmap),
              shape = Map.fetch!(filter.shapes, shape_id),
              Shape.is_affected_by_relation_change?(shape, relation) do
            ShapeBitmap.get_id!(filter.shape_bitmap, shape_id)
          end

        RoaringBitmap.from_list(shapes)

      %NewRecord{relation: relation, record: record} ->
        shapes_affected_by_record_bitmap(filter, relation, record)

      %DeletedRecord{relation: relation, old_record: record} ->
        shapes_affected_by_record_bitmap(filter, relation, record)

      %UpdatedRecord{relation: relation} = change ->
        # Union of old and new record matches
        RoaringBitmap.union(
          shapes_affected_by_record_bitmap(filter, relation, change.record),
          shapes_affected_by_record_bitmap(filter, relation, change.old_record)
        )

      %TruncatedRelation{relation: table_name} ->
        shape_ids_for_table_bitmap(filter, table_name)
    end
  end

  defp shapes_affected_by_record_bitmap(filter, table_name, record) do
    case Map.get(filter.tables, table_name) do
      nil ->
        RoaringBitmap.new()

      condition ->
        WhereCondition.affected_shapes_bitmap(
          condition,
          record,
          filter.shapes,
          filter.shape_bitmap,
          filter.refs_fun
        )
    end
  end

  defp all_shape_ids(%Filter{} = filter) do
    # For backward compatibility, convert bitmap to MapSet
    bitmap = ShapeBitmap.all_shapes_bitmap(filter.shape_bitmap)
    ShapeBitmap.to_handles(filter.shape_bitmap, bitmap)
  end

  defp shape_ids_for_table_bitmap(%Filter{} = filter, table_name) do
    case Map.get(filter.tables, table_name) do
      nil -> RoaringBitmap.new()
      condition -> WhereCondition.all_shapes_bitmap(condition, filter.shape_bitmap)
    end
  end
end
