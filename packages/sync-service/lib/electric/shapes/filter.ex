defmodule Electric.Shapes.Filter do
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

  def new(shapes), do: shapes |> Map.to_list() |> new(empty())
  defp new([{handle, shape} | shapes], filter), do: new(shapes, add_shape(filter, handle, shape))
  defp new([], filter), do: filter

  def add_shape(%Filter{tables: tables}, handle, shape) do
    %Filter{
      tables:
        Map.update(
          tables,
          shape.root_table,
          Table.add_shape(Table.empty(), {handle, shape}),
          fn table ->
            Table.add_shape(table, {handle, shape})
          end
        )
    }
  end

  def remove_shape(%Filter{tables: tables}, handle) do
    %Filter{
      tables:
        tables
        |> Enum.map(fn {table_name, table} ->
          {table_name, Table.remove_shape(table, handle)}
        end)
        |> Enum.reject(fn {_table, table} -> map_size(table.indexes) == 0 end)
        |> Map.new()
    }
  end

  def empty, do: %Filter{}

  def affected_shapes(%Filter{} = filter, %Relation{} = relation) do
    # Check all shapes is all tables becuase the table may have been renamed
    for {handle, shape} <- all_shapes_in_filter(filter),
        Shape.is_affected_by_relation_change?(shape, relation),
        into: MapSet.new() do
      handle
    end
  end

  def affected_shapes(%Filter{} = filter, %Transaction{changes: changes}) do
    changes
    |> Enum.map(&affected_shapes(filter, &1))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
  end

  # TODO: Optimisation: each time a shape is affected, take it out of `other_shapes`

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

  # TODO: Optimisation: Do TruncatedRelations first and then just process other changes for other tables

  def affected_shapes(%Filter{} = filter, %TruncatedRelation{relation: table_name}) do
    for {handle, _shape} <- all_shapes_for_table(filter, table_name),
        into: MapSet.new() do
      handle
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
        {handle, shape} <- all_shapes_in_table(table),
        into: %{} do
      {handle, shape}
    end
  end

  defp all_shapes_in_table(%{indexes: indexes, other_shapes: other_shapes}) do
    for {_field, %{values: values}} <- indexes,
        {_value, shapes} <- values,
        %{handle: handle, shape: shape} <- shapes,
        into: %{} do
      {handle, shape}
    end
    |> Map.merge(other_shapes)
  end

  defp all_shapes_for_table(%Filter{} = filter, table_name) do
    case Map.get(filter.tables, table_name) do
      nil ->
        %{}

      table ->
        all_shapes_in_table(table)
    end
  end
end
