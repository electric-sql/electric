defmodule Electric.Shapes.WhereClause do
  @moduledoc """
  Functions for evaluating WHERE clause conditions against records.

  Supports DNF-based active conditions computation for arbitrary boolean
  expressions with subqueries.
  """

  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Eval.Walker
  alias Electric.Replication.Eval.Parser.{Const, Func, Ref, RowExpr, Array}

  def includes_record?(where_clause, record, extra_refs \\ %{})
  def includes_record?(nil = _where_clause, _record, _), do: true

  def includes_record?(where_clause, record, extra_refs) do
    with {:ok, refs} <- Runner.record_to_ref_values(where_clause.used_refs, record),
         {:ok, evaluated} <- Runner.execute(where_clause, Map.merge(refs, extra_refs)) do
      if is_nil(evaluated), do: false, else: evaluated
    else
      _ -> false
    end
  end

  @doc """
  Compute active_conditions array for a record.

  Returns a list of booleans, one per position in the DNF decomposition.
  Each boolean indicates whether that atomic condition is satisfied.

  ## Parameters
  - decomposition: The DNF decomposition from Decomposer.decompose/1
  - record: The record map to evaluate against
  - extra_refs: Additional reference values (e.g., from subquery results)
  - used_refs: The used_refs from the where clause (for type information)

  ## Examples

      iex> compute_active_conditions(decomposition, %{"x" => 1, "y" => 2}, %{}, used_refs)
      {:ok, [true, false, true]}
  """
  @spec compute_active_conditions(map() | nil, map(), map(), map()) :: {:ok, [boolean()]} | {:error, term()}
  def compute_active_conditions(nil, _record, _extra_refs, _used_refs), do: {:ok, []}

  def compute_active_conditions(decomposition, record, extra_refs, used_refs) do
    position_count = decomposition.position_count

    if position_count == 0 do
      {:ok, []}
    else
      # Get ref values from the record
      case Runner.record_to_ref_values(used_refs, record) do
        {:ok, ref_values} ->
          all_refs = Map.merge(ref_values, extra_refs)

          results =
            Enum.map(0..(position_count - 1), fn position ->
              subexpr = Map.fetch!(decomposition.subexpressions, position)
              evaluate_subexpression(subexpr.ast, all_refs)
            end)

          {:ok, results}

        :error ->
          {:error, :could_not_parse_refs}
      end
    end
  end

  @doc """
  Evaluate DNF to determine if record is included based on active conditions.

  A record is included if at least one disjunct (conjunction) is fully satisfied.
  A conjunction is satisfied if all its literals evaluate to true, considering polarity.

  ## Parameters
  - active_conditions: List of booleans from compute_active_conditions/4
  - disjuncts: List of conjunctions from decomposition.disjuncts

  ## Examples

      # active_conditions = [true, false]
      # disjuncts = [[{0, :positive}], [{1, :positive}]]  # A OR B
      iex> evaluate_dnf([true, false], [[{0, :positive}], [{1, :positive}]])
      true  # First disjunct satisfied
  """
  @spec evaluate_dnf([boolean()], [[{non_neg_integer(), :positive | :negated}]]) :: boolean()
  def evaluate_dnf([], [[]]), do: true
  def evaluate_dnf([], _disjuncts), do: false

  def evaluate_dnf(active_conditions, disjuncts) do
    Enum.any?(disjuncts, fn conjunction ->
      evaluate_conjunction(active_conditions, conjunction)
    end)
  end

  @doc """
  Evaluate a single conjunction (AND of literals).

  Returns true if all literals in the conjunction are satisfied.
  """
  @spec evaluate_conjunction([boolean()], [{non_neg_integer(), :positive | :negated}]) :: boolean()
  def evaluate_conjunction(_active_conditions, []), do: true

  def evaluate_conjunction(active_conditions, conjunction) do
    Enum.all?(conjunction, fn {pos, polarity} ->
      value = Enum.at(active_conditions, pos, false)
      case polarity do
        :positive -> value == true
        :negated -> value == false
      end
    end)
  end

  @doc """
  Find which disjuncts are satisfied by the active conditions.

  Returns a list of indices (0-based) of satisfied disjuncts.
  """
  @spec satisfied_disjuncts([boolean()], [[{non_neg_integer(), :positive | :negated}]]) :: [non_neg_integer()]
  def satisfied_disjuncts(active_conditions, disjuncts) do
    disjuncts
    |> Enum.with_index()
    |> Enum.filter(fn {conjunction, _idx} ->
      evaluate_conjunction(active_conditions, conjunction)
    end)
    |> Enum.map(fn {_conjunction, idx} -> idx end)
  end

  # Evaluate a single subexpression AST against reference values
  defp evaluate_subexpression(ast, refs) do
    case Walker.fold(ast, &do_evaluate/3, refs) do
      {:ok, value} when is_boolean(value) -> value
      {:ok, nil} -> false
      {:ok, _other} -> true
      {:error, _} -> false
    end
  catch
    {:could_not_compute, _} -> false
  end

  # Evaluation functions for AST nodes
  defp do_evaluate(%Const{value: value}, _, _), do: {:ok, value}
  defp do_evaluate(%Ref{path: path}, _, refs), do: {:ok, Map.get(refs, path)}
  defp do_evaluate(%Array{}, %{elements: elements}, _), do: {:ok, elements}
  defp do_evaluate(%RowExpr{}, %{elements: elements}, _), do: {:ok, List.to_tuple(elements)}

  defp do_evaluate(%Func{strict?: false} = func, %{args: args}, _) do
    {:ok, try_apply(func, args)}
  end

  defp do_evaluate(%Func{strict?: true, variadic_arg: vararg_position} = func, %{args: args}, _) do
    has_nils? =
      case vararg_position do
        nil -> Enum.any?(args, &is_nil/1)
        pos -> Enum.any?(Enum.at(args, pos), &is_nil/1) or Enum.any?(args, &is_nil/1)
      end

    if has_nils? do
      {:ok, nil}
    else
      {:ok, try_apply(func, args)}
    end
  end

  defp try_apply(%Func{implementation: impl, map_over_array_in_pos: map_over_array_in_pos} = func, args) do
    case {impl, map_over_array_in_pos} do
      {{module, fun}, nil} ->
        apply(module, fun, args)

      {fun, nil} when is_function(fun) ->
        apply(fun, args)

      {{module, function}, 0} ->
        Electric.Utils.deep_map(hd(args), &apply(module, function, [&1 | tl(args)]))

      {function, 0} when is_function(function) ->
        Electric.Utils.deep_map(hd(args), &apply(function, [&1 | tl(args)]))

      {{module, function}, pos} ->
        Electric.Utils.deep_map(
          Enum.at(args, pos),
          &apply(module, function, List.replace_at(args, pos, &1))
        )

      {function, pos} when is_function(function) ->
        Electric.Utils.deep_map(Enum.at(args, pos), &apply(function, List.replace_at(args, pos, &1)))

      _ ->
        throw({:could_not_compute, %{func | args: args}})
    end
  rescue
    _ ->
      throw({:could_not_compute, %{func | args: args}})
  end
end
