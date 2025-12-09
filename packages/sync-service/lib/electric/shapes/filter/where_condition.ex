defmodule Electric.Shapes.Filter.WhereCondition do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change to a specific table.

  When `add_shape/4` is called, shapes are added to a tree stored in ETS. Each node on the tree represents
  an optimised (indexed) condition in the shape's where clause, with shapes that share an optimised condition
  being on the same branch.

  Each WhereCondition is identified by a unique reference and stores:
  - `index_keys`: MapSet of {field, operation} tuples for indexed conditions
  - `other_shapes`: map of shape_id -> where_clause for non-optimized shapes

  The logic for specific indexes (equality, inclusion) is handled by dedicated modules that also use ETS.
  """

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.WhereClause
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  def init(%Filter{where_cond_table: table}, condition_id) do
    :ets.insert(table, {condition_id, {MapSet.new(), %{}}})
  end

  def add_shape(%Filter{where_cond_table: table} = filter, condition_id, shape_id, where_clause) do
    case optimise_where(where_clause) do
      :not_optimised ->
        [{_, {index_keys, other_shapes}}] = :ets.lookup(table, condition_id)
        other_shapes = Map.put(other_shapes, shape_id, where_clause)
        :ets.insert(table, {condition_id, {index_keys, other_shapes}})

      optimisation ->
        add_shape_to_index(filter, condition_id, shape_id, optimisation)
    end
  end

  defp add_shape_to_index(
         %Filter{where_cond_table: table} = filter,
         condition_id,
         shape_id,
         optimisation
       ) do
    [{_, {index_keys, other_shapes}}] = :ets.lookup(table, condition_id)
    key = {optimisation.field, optimisation.operation}
    index_keys = MapSet.put(index_keys, key)
    :ets.insert(table, {condition_id, {index_keys, other_shapes}})

    Index.add_shape(filter, condition_id, shape_id, optimisation)
  end

  @doc false
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

  @doc """
  Remove a shape from a WhereCondition.

  Returns `:deleted` if the condition is now empty and was deleted,
  or `:ok` if the condition still has shapes.
  """
  @spec remove_shape(Filter.t(), reference(), String.t(), Expr.t() | nil) :: :deleted | :ok
  def remove_shape(
        %Filter{where_cond_table: table} = filter,
        condition_id,
        shape_id,
        where_clause
      ) do
    case optimise_where(where_clause) do
      :not_optimised ->
        remove_shape_from_other_shapes(table, condition_id, shape_id)

      optimisation ->
        remove_shape_from_index(filter, condition_id, shape_id, optimisation)
    end
  end

  defp remove_shape_from_other_shapes(table, condition_id, shape_id) do
    [{_, {index_keys, other_shapes}}] = :ets.lookup(table, condition_id)
    other_shapes = Map.delete(other_shapes, shape_id)
    update_or_delete_condition(table, condition_id, index_keys, other_shapes)
  end

  defp remove_shape_from_index(
         %Filter{where_cond_table: table} = filter,
         condition_id,
         shape_id,
         optimisation
       ) do
    case Index.remove_shape(filter, condition_id, shape_id, optimisation) do
      :deleted ->
        [{_, {index_keys, other_shapes}}] = :ets.lookup(table, condition_id)
        key = {optimisation.field, optimisation.operation}
        index_keys = MapSet.delete(index_keys, key)
        update_or_delete_condition(table, condition_id, index_keys, other_shapes)

      :ok ->
        :ok
    end
  end

  defp update_or_delete_condition(table, condition_id, index_keys, other_shapes)
       when index_keys == %MapSet{} and other_shapes == %{} do
    :ets.delete(table, condition_id)
    :deleted
  end

  defp update_or_delete_condition(table, condition_id, index_keys, other_shapes) do
    :ets.insert(table, {condition_id, {index_keys, other_shapes}})
    :ok
  end

  def affected_shapes(%Filter{where_cond_table: table} = filter, condition_id, record, refs_fun) do
    MapSet.union(
      indexed_shapes_affected(filter, condition_id, record),
      other_shapes_affected(filter, table, condition_id, record, refs_fun)
    )
  rescue
    error ->
      Logger.error("""
      Unexpected error in Filter.WhereCondition.affected_shapes:
      #{Exception.format(:error, error, __STACKTRACE__)}
      """)

      # We can't tell which shapes are affected, the safest thing to do is return all shapes
      all_shape_ids(filter, condition_id)
  end

  defp indexed_shapes_affected(%Filter{where_cond_table: table} = filter, condition_id, record) do
    OpenTelemetry.with_child_span(
      "filter.filter_using_indexes",
      [],
      fn ->
        [{_, {index_keys, _other_shapes}}] = :ets.lookup(table, condition_id)
        OpenTelemetry.add_span_attributes(index_count: MapSet.size(index_keys))

        index_keys
        |> Enum.map(fn {field, operation} ->
          Index.affected_shapes(filter, condition_id, field, operation, record)
        end)
        |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
      end
    )
  end

  defp other_shapes_affected(filter, table, condition_id, record, refs_fun) do
    [{_, {_index_keys, other_shapes}}] = :ets.lookup(table, condition_id)

    OpenTelemetry.with_child_span(
      "filter.filter_other_shapes",
      [shape_count: map_size(other_shapes)],
      fn ->
        for {shape_id, where} <- other_shapes,
            shape = Filter.get_shape(filter, shape_id),
            WhereClause.includes_record?(where, record, refs_fun.(shape)),
            into: MapSet.new() do
          shape_id
        end
      end
    )
  end

  def all_shape_ids(%Filter{where_cond_table: table} = filter, condition_id) do
    case :ets.lookup(table, condition_id) do
      [] ->
        MapSet.new()

      [{_, {index_keys, other_shapes}}] ->
        index_shapes =
          Enum.reduce(index_keys, MapSet.new(), fn {field, operation}, acc ->
            MapSet.union(acc, Index.all_shape_ids(filter, condition_id, field, operation))
          end)

        other_shape_ids =
          Enum.reduce(other_shapes, MapSet.new(), fn {shape_id, _}, acc ->
            MapSet.put(acc, shape_id)
          end)

        MapSet.union(index_shapes, other_shape_ids)
    end
  end
end
