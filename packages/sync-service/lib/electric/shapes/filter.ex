defmodule Electric.Shapes.Filter do
  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.NewRecord

  def new(shapes), do: new(shapes, empty())
  def new([shape | shapes], filter), do: new(shapes, add_shape(shape, filter))
  def new([], filter), do: filter

  defp empty, do: %{tables: %{}}
  defp empty_table_filter, do: %{fields: %{}, other_shapes: []}

  defp add_shape(shape, %{tables: tables}) do
    %{
      tables:
        Map.update(
          tables,
          shape.shape.root_table,
          add_shape_to_table_filter(shape, empty_table_filter()),
          fn table_filter -> add_shape_to_table_filter(shape, table_filter) end
        )
    }
  end

  defp add_shape_to_table_filter(%{shape: %{where: where}} = shape, table_filter) do
    case optimise_where(where) do
      %{operation: "=", field: field, value: value, and_where: and_where} ->
        %{
          table_filter
          | fields: add_shape_to_field_filter(field, value, shape, table_filter.fields, and_where)
        }

      :not_optimised ->
        %{table_filter | other_shapes: [shape | table_filter.other_shapes]}
    end
  end

  defp add_shape_to_field_filter(field, value, shape, fields, and_where) do
    Map.update(
      fields,
      field,
      add_shape_to_value_filter(value, shape, and_where, %{}),
      fn value_filter -> add_shape_to_value_filter(value, shape, and_where, value_filter) end
    )
  end

  defp add_shape_to_value_filter(value, shape, and_where, value_filter) do
    Map.update(
      value_filter,
      value,
      [%{handle: shape.handle, and_where: and_where}],
      fn shapes -> [%{handle: shape.handle, and_where: and_where} | shapes] end
    )
  end

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Replication.Eval.Parser.Const

  defp optimise_where(%Expr{
         eval: %Func{
           name: ~s("="),
           args: [
             %Ref{path: [field]},
             %Const{} = const
           ]
         }
       }) do
    %{operation: "=", field: field, value: const_to_string(const), and_where: nil}
  end

  defp optimise_where(_), do: :not_optimised

  defp const_to_string(%Const{value: value, type: :int4}), do: Integer.to_string(value)
  defp const_to_string(%Const{value: value, type: :int8}), do: Integer.to_string(value)

  def affected_shapes(filter, %Transaction{changes: changes}) do
    changes
    |> Enum.map(&affected_shapes(filter, &1))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
  end

  def affected_shapes(filter, %NewRecord{relation: relation, record: record}) do
    case Map.get(filter.tables, relation) do
      nil -> MapSet.new()
      table_filter -> affected_shapes_by_table(table_filter, record)
    end
  end

  defp affected_shapes_by_table(%{fields: fields} = table_filter, record) do
    fields
    |> Enum.map(&affected_shapes_by_field(&1, record))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
    |> MapSet.union(other_shapes_affected(table_filter, record))
  end

  def affected_shapes_by_field({field, values}, record) do
    case values[record[field]] do
      nil ->
        MapSet.new()

      shapes ->
        shapes
        |> Enum.map(& &1.handle)
        |> MapSet.new()
    end
  end

  defp other_shapes_affected(%{other_shapes: shapes}, record) do
    for %{handle: handle, shape: shape} <- shapes,
        Shape.record_in_shape?(shape, record),
        into: MapSet.new() do
      handle
    end
  end
end
