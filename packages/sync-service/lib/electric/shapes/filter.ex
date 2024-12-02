defmodule Electric.Shapes.Filter do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change.

  `affected_shapes(filter, change)` will return a set shape IDs that are affected by a change.
  """

  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Table
  alias Electric.Shapes.Shape

  defstruct tables: %{}

  def empty, do: %Filter{}

  def add_shape(%Filter{tables: tables}, shape_id, shape) do
    %Filter{
      tables:
        Map.update(
          tables,
          shape.root_table,
          Table.add_shape(Table.empty(), {shape_id, shape}),
          fn table ->
            Table.add_shape(table, {shape_id, shape})
          end
        )
    }
  end

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

  def affected_shapes(%Filter{} = filter, %Relation{} = relation) do
    # Check all shapes is all tables becuase the table may have been renamed
    for {shape_id, shape} <- all_shapes_in_filter(filter),
        Shape.is_affected_by_relation_change?(shape, relation),
        into: MapSet.new() do
      shape_id
    end
  end

  def affected_shapes(%Filter{} = filter, %Transaction{changes: changes}) do
    changes
    |> Enum.map(&affected_shapes(filter, &1))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
  end

  def affected_shapes(%Filter{} = filter, %NewRecord{relation: relation, record: record}) do
    affected_shapes_by_record(filter, relation, record)
  end

  def affected_shapes(%Filter{} = filter, %DeletedRecord{relation: relation, old_record: record}) do
    affected_shapes_by_record(filter, relation, record)
  end

  def affected_shapes(%Filter{} = filter, %UpdatedRecord{relation: relation} = change) do
    MapSet.union(
      affected_shapes_by_record(filter, relation, change.record),
      affected_shapes_by_record(filter, relation, change.old_record)
    )
  end

  def affected_shapes(%Filter{} = filter, %TruncatedRelation{relation: table_name}) do
    for {shape_id, _shape} <- all_shapes_for_table(filter, table_name),
        into: MapSet.new() do
      shape_id
    end
  end

  defp affected_shapes_by_record(filter, table_name, record) do
    case Map.get(filter.tables, table_name) do
      nil -> MapSet.new()
      table -> Table.affected_shapes(table, record)
    end
  end

  defp all_shapes_in_filter(%Filter{} = filter) do
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
