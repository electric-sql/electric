defmodule Electric.Shapes.Filter.Table do
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Table
  alias Electric.Shapes.Shape

  defstruct indexes: %{}, other_shapes: %{}

  def empty, do: %Table{}

  def add_shape(%Table{} = table, {handle, shape} = shape_instance) do
    case optimise_where(shape.where) do
      %{operation: "=", field: field, type: type, value: value, and_where: and_where} ->
        %{
          table
          | indexes:
              add_shape_to_indexes(
                field,
                type,
                value,
                shape_instance,
                table.indexes,
                and_where
              )
        }

      :not_optimised ->
        %{table | other_shapes: Map.put(table.other_shapes, handle, shape)}
    end
  end

  defp add_shape_to_indexes(field, type, value, shape_instance, indexes, and_where) do
    Map.update(
      indexes,
      field,
      Index.add_shape(value, shape_instance, and_where, Index.new(type)),
      fn field_filter ->
        Index.add_shape(value, shape_instance, and_where, field_filter)
      end
    )
  end

  defp optimise_where(%Expr{eval: eval}), do: optimise_where(eval)

  # TODO: Is this really ~s("=") or is it just "="?
  defp optimise_where(%Func{
         name: ~s("="),
         args: [%Ref{path: [field], type: type}, %Const{value: value}]
       }) do
    %{operation: "=", field: field, type: type, value: value, and_where: nil}
  end

  defp optimise_where(%Func{
         name: ~s("="),
         args: [%Const{value: value}, %Ref{path: [field], type: type}]
       }) do
    %{operation: "=", field: field, type: type, value: value, and_where: nil}
  end

  defp optimise_where(%Func{name: "and", args: [arg1, arg2]}) do
    case {optimise_where(arg1), optimise_where(arg2)} do
      {%{operation: "=", and_where: nil} = params, _} ->
        %{params | and_where: where_expr(arg2)}

      {_, %{operation: "=", and_where: nil} = params} ->
        %{params | and_where: where_expr(arg1)}

      _ ->
        :not_optimised
    end
  end

  defp optimise_where(_), do: :not_optimised

  defp where_expr(eval) do
    %Expr{eval: eval, used_refs: Parser.find_refs(eval), returns: :bool}
  end

  def remove_shape(%Table{indexes: indexes, other_shapes: other_shapes}, handle) do
    %Table{
      indexes: remove_shape_from_indexes(indexes, handle),
      other_shapes: Map.delete(other_shapes, handle)
    }
  end

  defp remove_shape_from_indexes(indexes, handle) do
    indexes
    |> Map.new(fn {field, index} -> {field, Index.remove_shape(index, handle)} end)
    |> Enum.reject(fn {_field, index} -> Index.empty?(index) end)
    |> Map.new()
  end

  def affected_shapes(%Table{indexes: indexes} = table, record) do
    indexes
    |> Enum.map(&Index.affected_shapes(&1, record))
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
    |> MapSet.union(other_shapes_affected(table, record))
  end

  defp other_shapes_affected(%{other_shapes: shapes}, record) do
    for {handle, shape} <- shapes,
        # TODO: Test Shape.record_in_shape? is called
        Shape.record_in_shape?(shape, record),
        into: MapSet.new() do
      handle
    end
  end
end
