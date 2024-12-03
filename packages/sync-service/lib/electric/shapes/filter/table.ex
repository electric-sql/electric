defmodule Electric.Shapes.Filter.Table do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change to a specific table.

  The `%Table{}` struct contains `indexes`, a map of indexes for shapes that have been optimised, and `other_shapes` for shapes
  that have not been optimised. The logic for specific indexes is delegated to the `Filter.Index` module.

  """

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Table
  alias Electric.Shapes.WhereClause

  require Logger

  defstruct indexes: %{}, other_shapes: %{}

  def new, do: %Table{}

  def empty?(%Table{indexes: indexes, other_shapes: other_shapes}) do
    indexes == %{} && other_shapes == %{}
  end

  def add_shape(%Table{} = table, {shape_id, shape} = shape_instance) do
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
        %{table | other_shapes: Map.put(table.other_shapes, shape_id, shape)}
    end
  end

  defp add_shape_to_indexes(field, type, value, shape_instance, indexes, and_where) do
    Map.update(
      indexes,
      field,
      Index.add_shape(Index.new(type), value, shape_instance, and_where),
      fn index ->
        Index.add_shape(index, value, shape_instance, and_where)
      end
    )
  end

  defp optimise_where(%Expr{eval: eval}), do: optimise_where(eval)

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

  def remove_shape(%Table{indexes: indexes, other_shapes: other_shapes}, shape_id) do
    %Table{
      indexes: remove_shape_from_indexes(indexes, shape_id),
      other_shapes: Map.delete(other_shapes, shape_id)
    }
  end

  defp remove_shape_from_indexes(indexes, shape_id) do
    indexes
    |> Map.new(fn {field, index} -> {field, Index.remove_shape(index, shape_id)} end)
    |> Enum.reject(fn {_field, index} -> Index.empty?(index) end)
    |> Map.new()
  end

  def affected_shapes(%Table{indexes: indexes} = table, record) do
    indexes
    |> Enum.map(fn {field, index} -> Index.affected_shapes(index, field, record) end)
    |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
    |> MapSet.union(other_shapes_affected(table, record))
  rescue
    error ->
      Logger.error("""
      Unexpected error in Filter.Table.affected_shapes:
      #{Exception.format(:error, error, __STACKTRACE__)}
      """)

      # We can't tell which shapes are affected, the safest thing to do is return all shapes
      table
      |> all_shapes()
      |> MapSet.new(fn {shape_id, _shape} -> shape_id end)
  end

  defp other_shapes_affected(%{other_shapes: shapes}, record) do
    for {shape_id, shape} <- shapes,
        WhereClause.includes_record?(shape.where, record),
        into: MapSet.new() do
      shape_id
    end
  end

  def all_shapes(%Table{indexes: indexes, other_shapes: other_shapes}) do
    for {_field, index} <- indexes, {shape_id, shape} <- Index.all_shapes(index), into: %{} do
      {shape_id, shape}
    end
    |> Map.merge(other_shapes)
  end
end
