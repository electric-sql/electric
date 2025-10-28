defmodule Electric.Shapes.Filter.WhereCondition do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change to a specific table.

  When `add_shape/3` is called, shapes are added to a tree of `%WhereCondition{}`s. Each node on the tree represents an optimised (indexed) condition in
  the shape's where clause, with shapes that share an optimised condition being on the same branch.

  The `%WhereCondition{}` struct contains `indexes`, a map of indexes for shapes that have been optimised, and `other_shapes` for shapes
  that have not been optimised (or have no conditions left to be optimised since they've been optimised at another level of the tree).
  The logic for specific indexes is delegated to the index's module. Each index may contain `%WhereCondition%{}`s
  and thus a tree of optimised conditions is formed.
  """

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.RoaringBitmap
  alias Electric.Shapes.ShapeBitmap
  alias Electric.Shapes.WhereClause
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defstruct indexes: %{}, other_shapes: %{}

  def new(), do: %WhereCondition{}

  def empty?(%WhereCondition{indexes: indexes, other_shapes: other_shapes}) do
    indexes == %{} && other_shapes == %{}
  end

  def add_shape(%WhereCondition{} = condition, shape_id, where_clause, shape_bitmap) do
    case optimise_where(where_clause) do
      :not_optimised ->
        %{
          condition
          | other_shapes: Map.put(condition.other_shapes, shape_id, where_clause)
        }

      optimisation ->
        %{
          condition
          | indexes: add_shape_to_indexes(condition.indexes, shape_id, optimisation, shape_bitmap)
        }
    end
  end

  defp add_shape_to_indexes(indexes, shape_id, optimisation, shape_bitmap) do
    Map.update(
      indexes,
      {optimisation.field, optimisation.operation},
      Index.add_shape(
        Index.new(optimisation.operation, optimisation.type),
        optimisation.value,
        shape_id,
        optimisation.and_where,
        shape_bitmap
      ),
      fn index ->
        Index.add_shape(index, optimisation.value, shape_id, optimisation.and_where, shape_bitmap)
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

  defp optimise_where(%Func{
         name: ~s("@>"),
         args: [%Ref{path: [field], type: type}, %Const{value: value}]
       })
       when is_list(value) do
    %{operation: "@>", field: field, type: type, value: value, and_where: nil}
  end

  defp optimise_where(%Func{
         name: ~s("<@"),
         args: [%Const{value: value}, %Ref{path: [field], type: type}]
       })
       when is_list(value) do
    %{operation: "@>", field: field, type: type, value: value, and_where: nil}
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

  def remove_shape(%WhereCondition{} = condition, shape_id, where_clause, shape_bitmap) do
    case optimise_where(where_clause) do
      :not_optimised ->
        %{condition | other_shapes: Map.delete(condition.other_shapes, shape_id)}

      optimisation ->
        %{
          condition
          | indexes: remove_shape_from_indexes(condition.indexes, shape_id, optimisation, shape_bitmap)
        }
    end
  end

  defp remove_shape_from_indexes(indexes, shape_id, optimisation, shape_bitmap) do
    index =
      indexes
      |> Map.fetch!({optimisation.field, optimisation.operation})
      |> Index.remove_shape(optimisation.value, shape_id, optimisation.and_where, shape_bitmap)

    if Index.empty?(index) do
      Map.delete(indexes, {optimisation.field, optimisation.operation})
    else
      Map.put(indexes, {optimisation.field, optimisation.operation}, index)
    end
  end

  def affected_shapes(%WhereCondition{} = condition, record, shapes, refs_fun \\ fn _ -> %{} end) do
    MapSet.union(
      indexed_shapes_affected(condition, record, shapes),
      other_shapes_affected(condition, record, shapes, refs_fun)
    )
  rescue
    error ->
      Logger.error("""
      Unexpected error in Filter.WhereCondition.affected_shapes:
      #{Exception.format(:error, error, __STACKTRACE__)}
      """)

      # We can't tell which shapes are affected, the safest thing to do is return all shapes
      all_shape_ids(condition)
  end

  @doc """
  Returns a RoaringBitmap of shape IDs affected by the given record.
  This is the performance-optimized version using bitmaps instead of MapSets.
  """
  def affected_shapes_bitmap(
        %WhereCondition{} = condition,
        record,
        shapes,
        shape_bitmap,
        refs_fun \\ fn _ -> %{} end
      ) do
    RoaringBitmap.union(
      indexed_shapes_affected_bitmap(condition, record, shapes, shape_bitmap),
      other_shapes_affected_bitmap(condition, record, shapes, shape_bitmap, refs_fun)
    )
  rescue
    error ->
      Logger.error("""
      Unexpected error in Filter.WhereCondition.affected_shapes_bitmap:
      #{Exception.format(:error, error, __STACKTRACE__)}
      """)

      # We can't tell which shapes are affected, the safest thing to do is return all shapes
      all_shapes_bitmap(condition, shape_bitmap)
  end

  defp indexed_shapes_affected(condition, record, shapes) do
    OpenTelemetry.with_child_span(
      "filter.filter_using_indexes",
      [index_count: map_size(condition.indexes)],
      fn ->
        condition.indexes
        |> Enum.map(fn {{field, _operation}, index} ->
          Index.affected_shapes(index, field, record, shapes)
        end)
        |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
      end
    )
  end

  defp other_shapes_affected(condition, record, shapes, refs_fun) do
    OpenTelemetry.with_child_span(
      "filter.filter_other_shapes",
      [shape_count: map_size(condition.other_shapes)],
      fn ->
        for {shape_id, where} <- condition.other_shapes,
            shape = Map.fetch!(shapes, shape_id),
            WhereClause.includes_record?(where, record, refs_fun.(shape)),
            into: MapSet.new() do
          shape_id
        end
      end
    )
  end

  def all_shape_ids(%WhereCondition{indexes: indexes, other_shapes: other_shapes}) do
    MapSet.union(
      Enum.reduce(indexes, MapSet.new(), fn {_key, index}, ids ->
        MapSet.union(ids, Index.all_shape_ids(index))
      end),
      Enum.reduce(other_shapes, MapSet.new(), fn {shape_id, _}, ids ->
        MapSet.put(ids, shape_id)
      end)
    )
  end

  defp indexed_shapes_affected_bitmap(condition, record, shapes, shape_bitmap) do
    OpenTelemetry.with_child_span(
      "filter.filter_using_indexes",
      [index_count: map_size(condition.indexes)],
      fn ->
        condition.indexes
        |> Enum.map(fn {{field, _operation}, index} ->
          Index.affected_shapes_bitmap(index, field, record, shapes, shape_bitmap)
        end)
        |> Enum.reduce(RoaringBitmap.new(), &RoaringBitmap.union(&1, &2))
      end
    )
  end

  defp other_shapes_affected_bitmap(condition, record, shapes, shape_bitmap, refs_fun) do
    OpenTelemetry.with_child_span(
      "filter.filter_other_shapes",
      [shape_count: map_size(condition.other_shapes)],
      fn ->
        shape_ids =
          for {shape_id, where} <- condition.other_shapes,
              shape = Map.fetch!(shapes, shape_id),
              WhereClause.includes_record?(where, record, refs_fun.(shape)) do
            ShapeBitmap.get_id!(shape_bitmap, shape_id)
          end

        RoaringBitmap.from_list(shape_ids)
      end
    )
  end

  @doc """
  Returns a RoaringBitmap of all shape IDs in the condition.
  """
  def all_shapes_bitmap(%WhereCondition{indexes: indexes, other_shapes: other_shapes}, shape_bitmap) do
    indexed_bitmap =
      Enum.reduce(indexes, RoaringBitmap.new(), fn {_key, index}, bitmap ->
        RoaringBitmap.union(bitmap, Index.all_shapes_bitmap(index, shape_bitmap))
      end)

    other_bitmap =
      other_shapes
      |> Map.keys()
      |> Enum.map(&ShapeBitmap.get_id!(shape_bitmap, &1))
      |> RoaringBitmap.from_list()

    RoaringBitmap.union(indexed_bitmap, other_bitmap)
  end
end
