defmodule Electric.Shapes.Filter do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change.

  `affected_shapes(filter, change)` will return a set of IDs for the shapes that are affected by the change
  considering all the shapes that have been added to the filter using `add_shape/3`.


  The `Filter` module keeps track of what tables are referenced by the shapes and changes and delegates
  the table specific logic to the `Filter.WhereCondition` module.
  """

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defstruct tables: %{}, refs_fun: nil, shapes: %{}

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

    %Filter{
      filter
      | tables:
          Map.update(
            filter.tables,
            shape.root_table,
            WhereCondition.add_shape(WhereCondition.new(), shape_id, shape.where),
            fn condition ->
              WhereCondition.add_shape(condition, shape_id, shape.where)
            end
          ),
        shapes: Map.put(filter.shapes, shape_id, shape)
    }
  end

  @doc """
  Remove a shape from the filter.
  """
  @spec remove_shape(Filter.t(), shape_id()) :: Filter.t()
  def remove_shape(%Filter{} = filter, shape_id) do
    shape = Map.fetch!(filter.shapes, shape_id)

    condition =
      Map.fetch!(filter.tables, shape.root_table)
      |> WhereCondition.remove_shape(shape_id, shape.where)

    tables =
      if WhereCondition.empty?(condition) do
        Map.delete(filter.tables, shape.root_table)
      else
        Map.put(filter.tables, shape.root_table, condition)
      end

    %Filter{filter | tables: tables, shapes: Map.delete(filter.shapes, shape_id)}
  end

  @doc """
  Returns the shape IDs for all shapes that have been added to the filter
  that are affected by the given change.
  """
  @spec affected_shapes(Filter.t(), Changes.change() | Relation.t()) ::
          MapSet.t(shape_id())
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

  defp shapes_affected_by_change(%Filter{} = filter, %Relation{} = relation) do
    # Check all shapes is all tables because the table may have been renamed
    for shape_id <- all_shape_ids(filter),
        shape = Map.fetch!(filter.shapes, shape_id),
        Shape.is_affected_by_relation_change?(shape, relation),
        into: MapSet.new() do
      shape_id
    end
  end

  defp shapes_affected_by_change(%Filter{} = filter, %NewRecord{
         relation: relation,
         record: record
       }) do
    shapes_affected_by_record(filter, relation, record)
  end

  defp shapes_affected_by_change(%Filter{} = filter, %DeletedRecord{
         relation: relation,
         old_record: record
       }) do
    shapes_affected_by_record(filter, relation, record)
  end

  defp shapes_affected_by_change(%Filter{} = filter, %UpdatedRecord{relation: relation} = change) do
    MapSet.union(
      shapes_affected_by_record(filter, relation, change.record),
      shapes_affected_by_record(filter, relation, change.old_record)
    )
  end

  defp shapes_affected_by_change(%Filter{} = filter, %TruncatedRelation{relation: table_name}) do
    shape_ids_for_table(filter, table_name)
  end

  defp shapes_affected_by_record(filter, table_name, record) do
    case Map.get(filter.tables, table_name) do
      nil ->
        MapSet.new()

      condition ->
        WhereCondition.affected_shapes(condition, record, filter.shapes, filter.refs_fun)
    end
  end

  defp all_shape_ids(%Filter{} = filter) do
    Enum.reduce(filter.tables, MapSet.new(), fn {_table, condition}, ids ->
      MapSet.union(ids, WhereCondition.all_shape_ids(condition))
    end)
  end

  defp shape_ids_for_table(%Filter{} = filter, table_name) do
    case Map.get(filter.tables, table_name) do
      nil -> MapSet.new()
      condition -> WhereCondition.all_shape_ids(condition)
    end
  end
end
