defmodule Electric.Shapes.Filter.WhereCondition do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change to a specific table.

  When `add_shape/4` is called, shapes are added to a tree stored in ETS. Each node on the tree represents
  an optimised (indexed) condition in the shape's where clause, with shapes that share an optimised condition
  being on the same branch.

  Each WhereCondition is identified by a unique condition id and stores:
  - `index_keys`: MapSet of {field_key, operation} tuples for indexed conditions, kept in
    the filter's `where_cond_table` as `{condition_id, index_keys}`
  - `other_shapes`: the where clauses of non-optimised shapes, kept in the filter's
    `other_shapes_table` (an `:ordered_set`) as one row per shape:
    `{{condition_id, shape_id, branch_key}, where_clause}`. Storing them as individual
    rows keeps add/remove O(1) in the number of shapes on the node (a single aggregate
    row would be copied in and out of ETS on every operation), while a key pattern with
    the `condition_id` bound makes `:ets.match_object`/`:ets.select` traverse only that
    node's rows.

  The logic for specific indexes (equality, inclusion) is handled by dedicated modules that also use ETS.
  """

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Replication.Eval.Parser.RowExpr
  alias Electric.Replication.PostgresInterop.Casting
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.WhereClause
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  def init(%Filter{where_cond_table: table}, condition_id) do
    :ets.insert(table, {condition_id, MapSet.new()})
  end

  @doc """
  Returns `true` when the WHERE clause can use the filter's indexed routing
  path instead of relying entirely on `other_shapes`.
  """
  @spec indexed_where?(Expr.t() | nil) :: boolean()
  def indexed_where?(where_clause), do: optimise_where(where_clause) != :not_optimised

  def add_shape(%Filter{} = filter, condition_id, shape_id, where_clause) do
    add_shape(filter, condition_id, shape_id, where_clause, [])
  end

  @doc false
  def add_shape(%Filter{} = filter, condition_id, shape_id, where_clause, branch_key) do
    case optimise_where(where_clause) do
      :not_optimised ->
        add_shape_to_other_shapes(filter, condition_id, shape_id, branch_key, where_clause)

      {:or, left, right} ->
        add_shape(filter, condition_id, shape_id, left, branch_key ++ [:left])
        add_shape(filter, condition_id, shape_id, right, branch_key ++ [:right])

      %{operation: _} = optimisation ->
        add_shape_to_index(filter, condition_id, shape_id, optimisation, branch_key)
    end
  end

  defp add_shape_to_other_shapes(
         %Filter{other_shapes_table: table},
         condition_id,
         shape_id,
         branch_key,
         where_clause
       ) do
    :ets.insert(table, {{condition_id, shape_id, branch_key}, where_clause})
  end

  defp add_shape_to_index(
         %Filter{where_cond_table: table} = filter,
         condition_id,
         shape_id,
         optimisation,
         branch_key
       ) do
    [{_, index_keys}] = :ets.lookup(table, condition_id)
    key = {optimisation.field, optimisation.operation}
    :ets.insert(table, {condition_id, MapSet.put(index_keys, key)})

    Index.add_shape(filter, condition_id, shape_id, optimisation, branch_key)
  end

  @doc false
  defp optimise_where(nil), do: :not_optimised

  defp optimise_where(%Expr{eval: eval}), do: optimise_where(eval)

  defp optimise_where(%Func{name: "or", args: [left, right]}) do
    if optimise_where(left) != :not_optimised and optimise_where(right) != :not_optimised do
      {:or, where_expr(left), where_expr(right)}
    else
      :not_optimised
    end
  end

  defp optimise_where(%Func{name: "and", args: [left, right]}) do
    case {optimise_where(left), optimise_where(right)} do
      {%{operation: _} = optimisation, _} ->
        %{optimisation | and_where: merge_and_where(optimisation.and_where, right)}

      {_, %{operation: _} = optimisation} ->
        %{optimisation | and_where: merge_and_where(left, optimisation.and_where)}

      _ ->
        :not_optimised
    end
  end

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

  # const = ANY(array_ref) → reuse @> index with [const] as single-element array
  defp optimise_where(%Func{
         name: "any",
         args: [
           %Func{
             name: ~s("="),
             map_over_array_in_pos: 1,
             args: [%Const{value: value}, %Ref{path: [field], type: {:array, _} = type}]
           }
         ]
       })
       when not is_nil(value) do
    %{operation: "@>", field: field, type: type, value: [value], and_where: nil}
  end

  defp optimise_where(%Func{name: "sublink_membership_check"} = subquery) do
    subquery_optimisation(subquery, :positive)
  end

  defp optimise_where(%Func{
         name: "not",
         args: [%Func{name: "sublink_membership_check"} = subquery]
       }) do
    subquery_optimisation(subquery, :negated)
  end

  defp optimise_where(_), do: :not_optimised

  defp where_expr(eval) do
    %Expr{eval: eval, used_refs: Parser.find_refs(eval), returns: :bool}
  end

  defp merge_and_where(nil, nil), do: nil

  defp merge_and_where(left, nil), do: normalise_where(left)

  defp merge_and_where(nil, right), do: normalise_where(right)

  defp merge_and_where(left, right) do
    left_eval = extract_eval(left)
    right_eval = extract_eval(right)

    where_expr(%Func{
      args: [left_eval, right_eval],
      type: :bool,
      implementation: &Casting.pg_and/2,
      name: "and",
      strict?: false,
      location: min(Map.get(left_eval, :location, 0), Map.get(right_eval, :location, 0))
    })
  end

  defp normalise_where(%Expr{} = expr), do: expr
  defp normalise_where(eval), do: where_expr(eval)

  defp extract_eval(%Expr{eval: eval}), do: eval
  defp extract_eval(eval), do: eval

  defp subquery_optimisation(
         %Func{name: "sublink_membership_check", args: [testexpr, %Ref{path: subquery_ref}]} =
           _subquery,
         polarity
       ) do
    with {:ok, field_key} <- subquery_field_key(testexpr),
         {:ok, dep_index} <- dep_index_from_ref(subquery_ref) do
      %{
        operation: "subquery",
        field: field_key,
        testexpr: testexpr,
        subquery_ref: subquery_ref,
        dep_index: dep_index,
        polarity: polarity,
        and_where: nil
      }
    else
      _ -> :not_optimised
    end
  end

  @doc """
  Remove a shape from a WhereCondition.

  Returns `:deleted` if the condition is now empty and was deleted,
  or `:ok` if the condition still has shapes.
  """
  @spec remove_shape(Filter.t(), reference(), String.t(), Expr.t() | nil) :: :deleted | :ok
  def remove_shape(%Filter{} = filter, condition_id, shape_id, where_clause) do
    remove_shape(filter, condition_id, shape_id, where_clause, [])
  end

  @doc false
  def remove_shape(%Filter{} = filter, condition_id, shape_id, where_clause, branch_key) do
    case optimise_where(where_clause) do
      :not_optimised ->
        remove_shape_from_other_shapes(filter, condition_id, shape_id, branch_key)

      {:or, left, right} ->
        _ = remove_shape(filter, condition_id, shape_id, left, branch_key ++ [:left])
        _ = remove_shape(filter, condition_id, shape_id, right, branch_key ++ [:right])
        condition_status(filter, condition_id)

      %{operation: _} = optimisation ->
        remove_shape_from_index(filter, condition_id, shape_id, optimisation, branch_key)
    end
  end

  defp remove_shape_from_other_shapes(
         %Filter{other_shapes_table: table} = filter,
         condition_id,
         shape_id,
         branch_key
       ) do
    :ets.delete(table, {condition_id, shape_id, branch_key})
    delete_condition_if_empty(filter, condition_id)
  end

  defp remove_shape_from_index(
         %Filter{where_cond_table: table} = filter,
         condition_id,
         shape_id,
         optimisation,
         branch_key
       ) do
    case Index.remove_shape(filter, condition_id, shape_id, optimisation, branch_key) do
      :deleted ->
        case :ets.lookup(table, condition_id) do
          [] ->
            :deleted

          [{_, index_keys}] ->
            key = {optimisation.field, optimisation.operation}
            :ets.insert(table, {condition_id, MapSet.delete(index_keys, key)})
            delete_condition_if_empty(filter, condition_id)
        end

      :ok ->
        :ok
    end
  end

  defp condition_status(%Filter{where_cond_table: table}, condition_id) do
    case :ets.lookup(table, condition_id) do
      [] -> :deleted
      [_] -> :ok
    end
  end

  defp delete_condition_if_empty(%Filter{where_cond_table: table} = filter, condition_id) do
    case :ets.lookup(table, condition_id) do
      [] ->
        :deleted

      [{_, index_keys}] ->
        if MapSet.size(index_keys) == 0 and not has_other_shapes?(filter, condition_id) do
          :ets.delete(table, condition_id)
          :deleted
        else
          :ok
        end
    end
  end

  defp has_other_shapes?(%Filter{other_shapes_table: table}, condition_id) do
    :ets.select(table, [{{{condition_id, :_, :_}, :_}, [], [true]}], 1) != :"$end_of_table"
  end

  def affected_shapes(%Filter{} = filter, condition_id, record) do
    MapSet.union(
      indexed_shapes_affected(filter, condition_id, record),
      other_shapes_affected(filter, condition_id, record)
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
        [{_, index_keys}] = :ets.lookup(table, condition_id)
        OpenTelemetry.add_span_attributes(index_count: MapSet.size(index_keys))

        index_keys
        |> Enum.map(fn {field, operation} ->
          Index.affected_shapes(filter, condition_id, field, operation, record)
        end)
        |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
      end
    )
  end

  defp other_shapes_affected(
         %Filter{subquery_index: index, other_shapes_table: table},
         condition_id,
         record
       ) do
    other_shapes = :ets.match_object(table, {{condition_id, :_, :_}, :_})

    OpenTelemetry.with_child_span(
      "filter.filter_other_shapes",
      [shape_count: length(other_shapes)],
      fn ->
        for {{_condition_id, shape_id, _branch_key}, where} <- other_shapes,
            other_shape_matches?(index, shape_id, where, record),
            into: MapSet.new() do
          shape_id
        end
      end
    )
  end

  defp other_shape_matches?(index, shape_id, where, record) do
    case WhereClause.includes_record_result(
           where,
           record,
           WhereClause.subquery_member_from_index(index, shape_id)
         ) do
      {:ok, included?} -> included?
      :error -> true
    end
  end

  defp subquery_field_key(%Ref{path: [field]}), do: {:ok, field}

  defp subquery_field_key(%RowExpr{elements: elements}) do
    if Enum.all?(elements, &match?(%Ref{path: [_]}, &1)) do
      {:ok, Enum.map(elements, fn %Ref{path: [field]} -> field end)}
    else
      :error
    end
  end

  defp subquery_field_key(_), do: :error

  defp dep_index_from_ref([_prefix, dep_index]) when is_binary(dep_index) do
    case Integer.parse(dep_index) do
      {idx, ""} -> {:ok, idx}
      _ -> :error
    end
  end

  defp dep_index_from_ref(_), do: :error

  def all_shape_ids(
        %Filter{where_cond_table: table, other_shapes_table: other_shapes_table} = filter,
        condition_id
      ) do
    case :ets.lookup(table, condition_id) do
      [] ->
        MapSet.new()

      [{_, index_keys}] ->
        index_shapes =
          Enum.reduce(index_keys, MapSet.new(), fn {field, operation}, acc ->
            MapSet.union(acc, Index.all_shape_ids(filter, condition_id, field, operation))
          end)

        other_shape_ids =
          other_shapes_table
          |> :ets.select([{{{condition_id, :"$1", :_}, :_}, [], [:"$1"]}])
          |> MapSet.new()

        MapSet.union(index_shapes, other_shape_ids)
    end
  end
end
