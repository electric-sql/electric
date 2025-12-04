defmodule Electric.Shapes.Filter.WhereCondition do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change to a specific table.

  When `add_shape/4` is called, shapes are added to a tree stored in ETS. Each node on the tree represents
  an optimised (indexed) condition in the shape's where clause, with shapes that share an optimised condition
  being on the same branch.

  Each WhereCondition is identified by a unique reference and stores:
  - `index_keys`: list of {field, operation} tuples for indexed conditions
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

  @doc """
  Initialize a new WhereCondition in ETS.
  """
  def init(%Filter{where_cond_table: table}, where_cond_id) do
    :ets.insert(table, {where_cond_id, {[], %{}}})
  end

  @doc """
  Check if a WhereCondition is empty (no indexes and no other_shapes).
  """
  def empty?(%Filter{where_cond_table: table} = filter, where_cond_id) do
    case :ets.lookup(table, where_cond_id) do
      [] ->
        true

      [{_, {index_keys, other_shapes}}] ->
        index_keys == [] and other_shapes == %{} and
          no_indexes?(filter, where_cond_id, index_keys)
    end
  end

  defp no_indexes?(filter, where_cond_id, index_keys) do
    Enum.all?(index_keys, fn {field, operation} ->
      Index.empty?(filter, where_cond_id, field, operation)
    end)
  end

  @doc """
  Delete a WhereCondition and its associated indexes from ETS.
  """
  def delete(%Filter{where_cond_table: table} = filter, where_cond_id) do
    case :ets.lookup(table, where_cond_id) do
      [{_, {index_keys, _other_shapes}}] ->
        # Delete all associated indexes
        Enum.each(index_keys, fn {field, operation} ->
          Index.delete_all(filter, where_cond_id, field, operation)
        end)

        :ets.delete(table, where_cond_id)

      [] ->
        :ok
    end
  end

  @doc """
  Add a shape to a WhereCondition.
  """
  def add_shape(%Filter{where_cond_table: table} = filter, where_cond_id, shape_id, where_clause) do
    case optimise_where(where_clause) do
      :not_optimised ->
        # Add to other_shapes
        [{_, {index_keys, other_shapes}}] = :ets.lookup(table, where_cond_id)
        updated_other = Map.put(other_shapes, shape_id, where_clause)
        :ets.insert(table, {where_cond_id, {index_keys, updated_other}})

      optimisation ->
        # Add to appropriate index
        add_shape_to_index(filter, where_cond_id, shape_id, optimisation)
    end
  end

  defp add_shape_to_index(
         %Filter{where_cond_table: table} = filter,
         where_cond_id,
         shape_id,
         optimisation
       ) do
    # Ensure the index_keys list includes this index
    [{_, {index_keys, other_shapes}}] = :ets.lookup(table, where_cond_id)
    key = {optimisation.field, optimisation.operation}

    updated_keys =
      if key in index_keys do
        index_keys
      else
        [key | index_keys]
      end

    :ets.insert(table, {where_cond_id, {updated_keys, other_shapes}})

    # Add shape to the index
    Index.add_shape(filter, where_cond_id, shape_id, optimisation)
  end

  @doc false
  def optimise_where(%Expr{eval: eval}), do: optimise_where(eval)

  def optimise_where(%Func{
        name: ~s("="),
        args: [%Ref{path: [field], type: type}, %Const{value: value}]
      }) do
    %{operation: "=", field: field, type: type, value: value, and_where: nil}
  end

  def optimise_where(%Func{
        name: ~s("="),
        args: [%Const{value: value}, %Ref{path: [field], type: type}]
      }) do
    %{operation: "=", field: field, type: type, value: value, and_where: nil}
  end

  def optimise_where(%Func{
        name: ~s("@>"),
        args: [%Ref{path: [field], type: type}, %Const{value: value}]
      })
      when is_list(value) do
    %{operation: "@>", field: field, type: type, value: value, and_where: nil}
  end

  def optimise_where(%Func{
        name: ~s("<@"),
        args: [%Const{value: value}, %Ref{path: [field], type: type}]
      })
      when is_list(value) do
    %{operation: "@>", field: field, type: type, value: value, and_where: nil}
  end

  def optimise_where(%Func{name: "and", args: [arg1, arg2]}) do
    case {optimise_where(arg1), optimise_where(arg2)} do
      {%{operation: "=", and_where: nil} = params, _} ->
        %{params | and_where: where_expr(arg2)}

      {_, %{operation: "=", and_where: nil} = params} ->
        %{params | and_where: where_expr(arg1)}

      _ ->
        :not_optimised
    end
  end

  def optimise_where(_), do: :not_optimised

  defp where_expr(eval) do
    %Expr{eval: eval, used_refs: Parser.find_refs(eval), returns: :bool}
  end

  @doc """
  Remove a shape from a WhereCondition.
  """
  def remove_shape(
        %Filter{where_cond_table: table} = filter,
        where_cond_id,
        shape_id,
        where_clause
      ) do
    case optimise_where(where_clause) do
      :not_optimised ->
        # Remove from other_shapes
        [{_, {index_keys, other_shapes}}] = :ets.lookup(table, where_cond_id)
        updated_other = Map.delete(other_shapes, shape_id)
        :ets.insert(table, {where_cond_id, {index_keys, updated_other}})

      optimisation ->
        # Remove from appropriate index
        remove_shape_from_index(filter, where_cond_id, shape_id, optimisation)
    end
  end

  defp remove_shape_from_index(
         %Filter{where_cond_table: table} = filter,
         where_cond_id,
         shape_id,
         optimisation
       ) do
    # Remove shape from the index
    Index.remove_shape(filter, where_cond_id, shape_id, optimisation)

    # If index is now empty, remove from index_keys
    if Index.empty?(filter, where_cond_id, optimisation.field, optimisation.operation) do
      [{_, {index_keys, other_shapes}}] = :ets.lookup(table, where_cond_id)
      key = {optimisation.field, optimisation.operation}
      updated_keys = List.delete(index_keys, key)
      :ets.insert(table, {where_cond_id, {updated_keys, other_shapes}})

      # Clean up the empty index
      Index.delete_all(filter, where_cond_id, optimisation.field, optimisation.operation)
    end
  end

  @doc """
  Find all shapes affected by a record change.
  """
  def affected_shapes(%Filter{where_cond_table: table} = filter, where_cond_id, record, refs_fun) do
    MapSet.union(
      indexed_shapes_affected(filter, where_cond_id, record),
      other_shapes_affected(filter, table, where_cond_id, record, refs_fun)
    )
  rescue
    error ->
      Logger.error("""
      Unexpected error in Filter.WhereCondition.affected_shapes:
      #{Exception.format(:error, error, __STACKTRACE__)}
      """)

      # We can't tell which shapes are affected, the safest thing to do is return all shapes
      all_shape_ids(filter, where_cond_id)
  end

  defp indexed_shapes_affected(%Filter{where_cond_table: table} = filter, where_cond_id, record) do
    OpenTelemetry.with_child_span(
      "filter.filter_using_indexes",
      [],
      fn ->
        [{_, {index_keys, _other_shapes}}] = :ets.lookup(table, where_cond_id)

        index_keys
        |> Enum.map(fn {field, operation} ->
          Index.affected_shapes(filter, where_cond_id, field, operation, record)
        end)
        |> Enum.reduce(MapSet.new(), &MapSet.union(&1, &2))
      end
    )
  end

  defp other_shapes_affected(filter, table, where_cond_id, record, refs_fun) do
    [{_, {_index_keys, other_shapes}}] = :ets.lookup(table, where_cond_id)

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

  @doc """
  Get all shape IDs in this WhereCondition and its nested conditions.
  """
  def all_shape_ids(%Filter{where_cond_table: table} = filter, where_cond_id) do
    case :ets.lookup(table, where_cond_id) do
      [] ->
        MapSet.new()

      [{_, {index_keys, other_shapes}}] ->
        # Collect from indexes
        index_shapes =
          Enum.reduce(index_keys, MapSet.new(), fn {field, operation}, acc ->
            MapSet.union(acc, Index.all_shape_ids(filter, where_cond_id, field, operation))
          end)

        # Collect from other_shapes
        other_shape_ids =
          Enum.reduce(other_shapes, MapSet.new(), fn {shape_id, _}, acc ->
            MapSet.put(acc, shape_id)
          end)

        MapSet.union(index_shapes, other_shape_ids)
    end
  end
end
