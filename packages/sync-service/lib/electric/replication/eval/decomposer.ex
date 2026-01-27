defmodule Electric.Replication.Eval.Decomposer do
  @moduledoc """
  Converts WHERE clause AST to Disjunctive Normal Form (DNF).

  DNF is a disjunction (OR) of conjunctions (AND) of literals.
  Each literal is either a positive or negated atomic condition.

  This module is used to enable arbitrary boolean expressions with subqueries,
  allowing the system to track which conditions caused a row's inclusion and
  handle move-in/move-out correctly without shape invalidation.

  ## Example

      # Input: WHERE (x IN subquery1 AND status = 'active') OR y IN subquery2
      iex> {:ok, decomposition} = Decomposer.decompose(ast)
      iex> decomposition.disjuncts
      [[{0, :positive}, {1, :positive}], [{2, :positive}]]
      iex> decomposition.subexpressions
      %{
        0 => %{ast: ..., is_subquery: true, column: "x"},
        1 => %{ast: ..., is_subquery: false, column: nil},
        2 => %{ast: ..., is_subquery: true, column: "y"}
      }

  ## Position Mapping

  Each atomic condition (subquery check, field comparison, etc.) is assigned
  a stable position. The position assignment is deterministic based on AST
  traversal order, ensuring consistent behavior across shape restarts.
  """

  alias Electric.Replication.Eval.Parser.{Func, Ref}

  @type position :: non_neg_integer()
  @type polarity :: :positive | :negated
  @type literal :: {position(), polarity()}
  @type conjunction :: [literal()]
  @type disjuncts :: [conjunction()]

  @type subexpression :: %{
          ast: term(),
          is_subquery: boolean(),
          column: String.t() | nil,
          negated: boolean()
        }

  @type decomposition :: %{
          disjuncts: disjuncts(),
          subexpressions: %{position() => subexpression()},
          position_count: non_neg_integer(),
          has_subqueries: boolean()
        }

  @doc """
  Decomposes a WHERE clause AST into DNF form.

  Returns a decomposition structure containing:
  - `disjuncts`: List of conjunctions (OR of ANDs), each conjunction is a list of {position, polarity}
  - `subexpressions`: Map from position to the atomic expression details
  - `position_count`: Total number of positions
  - `has_subqueries`: Whether any subquery expressions are present

  ## Examples

      # Simple IN subquery
      iex> decompose(parse("x IN (SELECT ...)"))
      {:ok, %{disjuncts: [[{0, :positive}]], ...}}

      # OR of subqueries
      iex> decompose(parse("x IN sq1 OR y IN sq2"))
      {:ok, %{disjuncts: [[{0, :positive}], [{1, :positive}]], ...}}

      # AND with field condition
      iex> decompose(parse("x IN sq1 AND status = 'active'"))
      {:ok, %{disjuncts: [[{0, :positive}, {1, :positive}]], ...}}

      # NOT with subquery
      iex> decompose(parse("x NOT IN sq1"))
      {:ok, %{disjuncts: [[{0, :negated}]], ...}}

  """
  @spec decompose(term()) :: {:ok, decomposition()} | {:error, term()}
  def decompose(ast) when ast == nil do
    {:ok,
     %{
       disjuncts: [[]],
       subexpressions: %{},
       position_count: 0,
       has_subqueries: false
     }}
  end

  def decompose(ast) do
    with {:ok, simplified} <- simplify(ast),
         {:ok, nnf} <- to_negation_normal_form(simplified),
         {:ok, dnf_ast} <- to_dnf(nnf),
         {:ok, {atomics, position_map}} <- collect_atomics(dnf_ast),
         {:ok, disjuncts} <- extract_disjuncts(dnf_ast, position_map) do
      has_subqueries = Enum.any?(atomics, fn {_pos, info} -> info.is_subquery end)

      {:ok,
       %{
         disjuncts: disjuncts,
         subexpressions: atomics,
         position_count: map_size(atomics),
         has_subqueries: has_subqueries
       }}
    end
  end

  @doc """
  Checks if an expression is "complex" (requires DNF decomposition).

  Returns true if the expression contains:
  - OR with subqueries
  - NOT with subqueries

  These are the cases that previously triggered shape invalidation.
  """
  @spec complex_expression?(term()) :: boolean()
  def complex_expression?(ast) do
    has_or_with_subquery?(ast) or has_not_with_subquery?(ast)
  end

  # Simplification: removes double negations and flattens nested AND/OR
  defp simplify(ast) do
    result = do_simplify(ast)
    {:ok, result}
  end

  defp do_simplify(%Func{name: "not", args: [%Func{name: "not", args: [inner]}]}) do
    # Double negation elimination: NOT NOT x => x
    do_simplify(inner)
  end

  defp do_simplify(%Func{name: "and", args: args} = func) do
    simplified_args = Enum.map(args, &do_simplify/1)
    # Flatten nested ANDs
    flat_args =
      Enum.flat_map(simplified_args, fn
        %Func{name: "and", args: nested} -> nested
        other -> [other]
      end)

    %{func | args: flat_args}
  end

  defp do_simplify(%Func{name: "or", args: args} = func) do
    simplified_args = Enum.map(args, &do_simplify/1)
    # Flatten nested ORs
    flat_args =
      Enum.flat_map(simplified_args, fn
        %Func{name: "or", args: nested} -> nested
        other -> [other]
      end)

    %{func | args: flat_args}
  end

  defp do_simplify(%Func{name: "not", args: [inner]} = func) do
    %{func | args: [do_simplify(inner)]}
  end

  defp do_simplify(%Func{args: args} = func) do
    %{func | args: Enum.map(args, &do_simplify/1)}
  end

  defp do_simplify(other), do: other

  # Convert to Negation Normal Form (NNF) by pushing NOT inward using De Morgan's laws
  defp to_negation_normal_form(ast) do
    result = do_nnf(ast, false)
    {:ok, result}
  end

  # Main NNF transformation - `negated` tracks if we're inside a negation
  defp do_nnf(%Func{name: "not", args: [inner]}, negated) do
    # Toggle negation and recurse
    do_nnf(inner, not negated)
  end

  defp do_nnf(%Func{name: "and", args: args} = func, false) do
    # Positive AND: just recurse
    %{func | args: Enum.map(args, &do_nnf(&1, false))}
  end

  defp do_nnf(%Func{name: "and", args: args}, true) do
    # Negated AND: De Morgan's law => OR of negated args
    # NOT (A AND B) => (NOT A) OR (NOT B)
    %Func{name: "or", args: Enum.map(args, &do_nnf(&1, true)), type: :bool}
  end

  defp do_nnf(%Func{name: "or", args: args} = func, false) do
    # Positive OR: just recurse
    %{func | args: Enum.map(args, &do_nnf(&1, false))}
  end

  defp do_nnf(%Func{name: "or", args: args}, true) do
    # Negated OR: De Morgan's law => AND of negated args
    # NOT (A OR B) => (NOT A) AND (NOT B)
    %Func{name: "and", args: Enum.map(args, &do_nnf(&1, true)), type: :bool}
  end

  defp do_nnf(atomic, false) do
    # Positive atomic expression
    atomic
  end

  defp do_nnf(atomic, true) do
    # Negated atomic expression - wrap in NOT
    %Func{name: "not", args: [atomic], type: :bool}
  end

  # Convert NNF to DNF by distributing AND over OR
  defp to_dnf(ast) do
    result = do_dnf(ast)
    {:ok, result}
  end

  defp do_dnf(%Func{name: "or", args: args} = func) do
    # Recursively convert children, then flatten
    converted = Enum.map(args, &do_dnf/1)

    flat_args =
      Enum.flat_map(converted, fn
        %Func{name: "or", args: nested} -> nested
        other -> [other]
      end)

    %{func | args: flat_args}
  end

  defp do_dnf(%Func{name: "and", args: args} = _func) do
    # Recursively convert children
    converted = Enum.map(args, &do_dnf/1)

    # Check if any child is an OR - if so, distribute
    case find_or_child(converted) do
      nil ->
        # All children are conjunctions or atoms - just rebuild AND
        %Func{name: "and", args: converted, type: :bool}

      {or_idx, %Func{name: "or", args: or_args}} ->
        # Distribute: A AND (B OR C) => (A AND B) OR (A AND C)
        other_args = List.delete_at(converted, or_idx)

        distributed =
          Enum.map(or_args, fn or_child ->
            new_and_args = other_args ++ [or_child]

            case new_and_args do
              [single] -> single
              multiple -> %Func{name: "and", args: multiple, type: :bool}
            end
          end)

        # Recursively apply DNF (may have more ORs to distribute)
        do_dnf(%Func{name: "or", args: distributed, type: :bool})
    end
  end

  defp do_dnf(%Func{name: "not", args: [_inner]} = func) do
    # NOT around an atomic - already in NNF, keep as-is
    func
  end

  defp do_dnf(%Func{args: args} = func) do
    # Other functions - recurse into args
    %{func | args: Enum.map(args, &do_dnf/1)}
  end

  defp do_dnf(other), do: other

  # Find first OR child in a list of expressions
  defp find_or_child(exprs) do
    exprs
    |> Enum.with_index()
    |> Enum.find_value(fn
      {%Func{name: "or"} = or_expr, idx} -> {idx, or_expr}
      _ -> nil
    end)
  end

  # Collect all atomic expressions and assign positions
  defp collect_atomics(ast) do
    atomics = do_collect_atomics(ast, []) |> Enum.reverse() |> Enum.uniq()

    position_map =
      atomics
      |> Enum.with_index()
      |> Enum.map(fn {{ast_node, negated}, idx} ->
        info = %{
          ast: if(negated, do: unwrap_not(ast_node), else: ast_node),
          is_subquery: is_subquery?(if(negated, do: unwrap_not(ast_node), else: ast_node)),
          column: extract_column(if(negated, do: unwrap_not(ast_node), else: ast_node)),
          negated: negated
        }

        {{ast_node, negated}, {idx, info}}
      end)
      |> Map.new()

    subexpressions =
      position_map
      |> Enum.map(fn {_key, {idx, info}} -> {idx, info} end)
      |> Map.new()

    {:ok, {subexpressions, position_map}}
  end

  defp do_collect_atomics(%Func{name: "or", args: args}, acc) do
    Enum.reduce(args, acc, &do_collect_atomics/2)
  end

  defp do_collect_atomics(%Func{name: "and", args: args}, acc) do
    Enum.reduce(args, acc, &do_collect_atomics/2)
  end

  defp do_collect_atomics(%Func{name: "not", args: [_inner]} = node, acc) do
    # Negated atomic
    [{node, true} | acc]
  end

  defp do_collect_atomics(node, acc) do
    # Positive atomic
    [{node, false} | acc]
  end

  # Extract disjuncts (conjunctions) from DNF AST
  defp extract_disjuncts(ast, position_map) do
    disjuncts =
      case ast do
        %Func{name: "or", args: args} ->
          Enum.map(args, &extract_conjunction(&1, position_map))

        conjunction ->
          [extract_conjunction(conjunction, position_map)]
      end

    {:ok, disjuncts}
  end

  defp extract_conjunction(%Func{name: "and", args: args}, position_map) do
    Enum.map(args, &extract_literal(&1, position_map))
  end

  defp extract_conjunction(atom, position_map) do
    [extract_literal(atom, position_map)]
  end

  defp extract_literal(%Func{name: "not", args: [_inner]} = node, position_map) do
    {idx, _info} = Map.fetch!(position_map, {node, true})
    {idx, :negated}
  end

  defp extract_literal(node, position_map) do
    {idx, _info} = Map.fetch!(position_map, {node, false})
    {idx, :positive}
  end

  # Helper to check if an expression is a subquery check
  defp is_subquery?(%Func{name: "sublink_membership_check"}), do: true
  defp is_subquery?(_), do: false

  # Helper to extract column name from an expression
  defp extract_column(%Func{name: "sublink_membership_check", args: [%Ref{path: [col]} | _]}) do
    col
  end

  defp extract_column(%Func{args: args}) do
    # Try to find a Ref in the args
    Enum.find_value(args, fn
      %Ref{path: [col]} -> col
      _ -> nil
    end)
  end

  defp extract_column(_), do: nil

  # Helper to unwrap NOT
  defp unwrap_not(%Func{name: "not", args: [inner]}), do: inner
  defp unwrap_not(other), do: other

  # Check for OR containing subqueries
  defp has_or_with_subquery?(%Func{name: "or", args: args}) do
    Enum.any?(args, &contains_subquery?/1)
  end

  defp has_or_with_subquery?(%Func{args: args}) do
    Enum.any?(args, &has_or_with_subquery?/1)
  end

  defp has_or_with_subquery?(_), do: false

  # Check for NOT containing subqueries
  defp has_not_with_subquery?(%Func{name: "not", args: [inner]}) do
    contains_subquery?(inner)
  end

  defp has_not_with_subquery?(%Func{args: args}) do
    Enum.any?(args, &has_not_with_subquery?/1)
  end

  defp has_not_with_subquery?(_), do: false

  # Check if expression contains any subquery
  defp contains_subquery?(%Func{name: "sublink_membership_check"}), do: true

  defp contains_subquery?(%Func{args: args}) do
    Enum.any?(args, &contains_subquery?/1)
  end

  defp contains_subquery?(_), do: false
end
