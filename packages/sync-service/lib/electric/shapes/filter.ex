defmodule Electric.Shapes.Filter do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change.

  `affected_shapes(filter, change)` will return a set of IDs for the shapes that are affected by the change
  considering all the shapes that have been added to the filter using `add_shape/3`.


  The `Filter` module keeps track of what tables are referenced by the shapes and changes and delegates
  the table specific logic to the `Filter.Table` module.
  """

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Table
  alias Electric.Shapes.Shape
  require Logger

  defstruct tables: %{}

  @type t :: %Filter{}
  @type shape_id :: any()

  @spec new() :: Filter.t()
  def new, do: %Filter{}

  @doc """
  Add a shape for the filter to track.

  The `shape_id` can be any term you like to identify the shape. Whatever you use will be returned
  by `affected_shapes/2` when the shape is affected by a change.
  """
  @spec add_shape(Filter.t(), shape_id(), Shape.t()) :: Filter.t()
  def add_shape(%Filter{tables: tables}, shape_id, shape) do
    %Filter{
      tables:
        Map.update(
          tables,
          shape.root_table,
          Table.add_shape(Table.new(), {shape_id, shape}),
          fn table ->
            Table.add_shape(table, {shape_id, shape})
          end
        )
    }
  end

  @doc """
  Remove a shape from the filter.
  """
  @spec remove_shape(Filter.t(), shape_id()) :: Filter.t()
  def remove_shape(%Filter{tables: tables}, shape_id) do
    %Filter{
      tables:
        tables
        |> Enum.map(fn {table_name, table} ->
          {table_name, Table.remove_shape(table, shape_id)}
        end)
        |> Enum.reject(fn {_table, table} -> Table.empty?(table) end)
        |> Map.new()
    }
  end

  @doc """
  Returns the shape IDs for all shapes that have been added to the filter
  that are affected by the given change.
  """
  @spec affected_shapes(Filter.t(), Changes.change()) :: MapSet.t(shape_id())
  def affected_shapes(%Filter{} = filter, change) do
    shapes_affected_by_change(filter, change)
  rescue
    error ->
      Logger.error("""
      Unexpected error in Filter.affected_shapes:
      #{Exception.format(:error, error, __STACKTRACE__)}
      """)

      # We can't tell which shapes are affected, the safest thing to do is return all shapes
      filter
      |> all_shapes()
      |> MapSet.new(fn {shape_id, _shape} -> shape_id end)
  end

  defp shapes_affected_by_change(%Filter{} = filter, %Relation{} = relation) do
    # Check all shapes is all tables becuase the table may have been renamed
    for {shape_id, shape} <- all_shapes(filter),
        Shape.is_affected_by_relation_change?(shape, relation),
        into: MapSet.new() do
      shape_id
    end
  end

  defp shapes_affected_by_change(%Filter{} = filter, %Transaction{changes: changes}) do
    changes
    |> Enum.map(&affected_shapes(filter, &1))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
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
    for {shape_id, _shape} <- all_shapes_for_table(filter, table_name),
        into: MapSet.new() do
      shape_id
    end
  end

  defp shapes_affected_by_record(filter, table_name, record) do
    case Map.get(filter.tables, table_name) do
      nil -> MapSet.new()
      table -> Table.affected_shapes(table, record)
    end
  end

  defp all_shapes(%Filter{} = filter) do
    for {_table, table} <- filter.tables,
        {shape_id, shape} <- Table.all_shapes(table),
        into: %{} do
      {shape_id, shape}
    end
  end

  defp all_shapes_for_table(%Filter{} = filter, table_name) do
    case Map.get(filter.tables, table_name) do
      nil -> %{}
      table -> Table.all_shapes(table)
    end
  end
end
