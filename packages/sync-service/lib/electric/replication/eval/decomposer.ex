defmodule Electric.Replication.Eval.Decomposer do
  @moduledoc """
  Decomposes a query to an expanded DNF form.

  Takes a where clause part of a query and decomposes it into a list of expressions
  in a Disjunctive Normal Form (DNF). Each expression is a conjunction of comparisons.

  To avoid duplication, it returns a list of lists, where the outer list is a list of disjuncts (conjunctions),
  and the inner list is a list of comparisons. Each comparison (i.e. the sub-expression of the original where clause)
  is represented by an Erlang reference, which is then mentioned in the map of references to the protobuf of the
  referenced subexpression.

  ## NOT handling

  To properly convert to DNF, NOT expressions are pushed down to leaf expressions using De Morgan's laws:
  - `NOT (a OR b)` becomes `(NOT a) AND (NOT b)`
  - `NOT (a AND b)` becomes `(NOT a) OR (NOT b)`

  Because of this, leaf expressions in the result can be either:
  - `ref` - a positive reference to a subexpression
  - `{:not, ref}` - a negated reference to a subexpression
  - `nil` - this position is not part of this disjunct

  The subexpressions map always contains the base (non-negated) form of each expression.

  ## Expanded format

  The "expanded" part means that each inner list MUST be the same length, equal to the total count of expressions
  across all disjuncts. Each position in the inner list corresponds to a specific expression slot from the original
  query structure, and contains either a reference (possibly negated) to that subexpression or `nil` if that
  expression is not part of the given disjunct.

  References allow deduplication: if the same subexpression appears in multiple disjuncts, they will share the
  same reference (but occupy different positions, since positions correspond to the original query structure).

  ## Examples

  For the query (already in a normalized form):

  ```sql
  WHERE (a = 1 AND b = 2) OR (c = 3 AND d = 4) OR (a = 1 AND c = 3)
  ```

  Has 3 disjuncts with 2 + 2 + 2 = 6 total expression slots. It will be decomposed into:

  ```
  [[r1, r2, nil, nil, nil, nil],
   [nil, nil, r3, r4, nil, nil],
   [nil, nil, nil, nil, r1, r3]]
  ```

  Where:
  - Positions 0-1 correspond to disjunct 1's expressions (`a = 1`, `b = 2`)
  - Positions 2-3 correspond to disjunct 2's expressions (`c = 3`, `d = 4`)
  - Positions 4-5 correspond to disjunct 3's expressions (`a = 1`, `c = 3`)
  - `r1` appears at positions 0 and 4 (same subexpression `a = 1`)
  - `r3` appears at positions 2 and 5 (same subexpression `c = 3`)

  The reference map will contain: `r1 => "a = 1"`, `r2 => "b = 2"`, `r3 => "c = 3"`, `r4 => "d = 4"`.

  For a query with NOT that needs De Morgan transformation:

  ```sql
  WHERE NOT (a = 1 OR b = 2)
  ```

  Becomes `(NOT a = 1) AND (NOT b = 2)` - a single disjunct with two negated terms:

  ```
  [[{:not, r1}, {:not, r2}]]
  ```

  And for:

  ```sql
  WHERE NOT (a = 1 AND b = 2)
  ```

  Becomes `(NOT a = 1) OR (NOT b = 2)` - two disjuncts:

  ```
  [[{:not, r1}, nil],
   [nil, {:not, r2}]]
  ```
  """

  @type pgquery_protobuf() :: PgQuery.Node.t()
  @type dnf_term() :: reference() | {:not, reference()} | nil

  @spec decompose(query :: pgquery_protobuf()) ::
          {[[dnf_term()]], %{reference() => pgquery_protobuf()}}
  def decompose(query) do
    # Phase 1: Convert to intermediate DNF (list of disjuncts, each is a list of {ast, negated?})
    internal_dnf = to_dnf(query, false)

    # Phase 2: Expand to fixed-width format with references
    expand(internal_dnf)
  end

  # Convert AST to internal DNF representation
  # negated? tracks whether we're inside a NOT context (for De Morgan transformations)
  defp to_dnf(
         %PgQuery.Node{node: {:bool_expr, %PgQuery.BoolExpr{boolop: boolop, args: args}}},
         negated
       ) do
    case {boolop, negated} do
      {:OR_EXPR, false} ->
        # OR: concatenate disjuncts from all branches
        Enum.flat_map(args, &to_dnf(&1, false))

      {:OR_EXPR, true} ->
        # NOT OR => AND (De Morgan's law)
        # NOT (a OR b) = NOT a AND NOT b
        args_dnfs = Enum.map(args, &to_dnf(&1, true))
        cross_product(args_dnfs)

      {:AND_EXPR, false} ->
        # AND: cross-product of disjuncts from all branches
        args_dnfs = Enum.map(args, &to_dnf(&1, false))
        cross_product(args_dnfs)

      {:AND_EXPR, true} ->
        # NOT AND => OR (De Morgan's law)
        # NOT (a AND b) = NOT a OR NOT b
        Enum.flat_map(args, &to_dnf(&1, true))

      {:NOT_EXPR, _} ->
        # NOT: flip the negation state (handles double negation automatically)
        [arg] = args
        to_dnf(arg, not negated)
    end
  end

  defp to_dnf(%PgQuery.Node{} = leaf, negated) do
    # Leaf expression: single disjunct with single term
    [[{leaf, negated}]]
  end

  # Cross-product of multiple DNF forms
  # Used for AND distribution: (A1 OR A2) AND (B1 OR B2) => (A1 AND B1) OR (A1 AND B2) OR (A2 AND B1) OR (A2 AND B2)
  defp cross_product([]), do: [[]]

  defp cross_product([dnf | rest]) do
    rest_product = cross_product(rest)

    for disjunct <- dnf, rest_disjunct <- rest_product do
      disjunct ++ rest_disjunct
    end
  end

  # Expand internal DNF to fixed-width format with references
  defp expand(internal_dnf) do
    # Calculate width of each disjunct and total width
    widths = Enum.map(internal_dnf, &length/1)
    total_width = Enum.sum(widths)

    # Calculate start positions for each disjunct: [0, w1, w1+w2, ...]
    start_positions = calc_start_positions(widths)

    # Build subexpressions map with deduplication based on SQL string
    {ast_to_ref, subexpressions} = build_subexpressions(internal_dnf)

    # Expand each disjunct to full width
    disjuncts =
      internal_dnf
      |> Enum.zip(start_positions)
      |> Enum.map(fn {disjunct, start_pos} ->
        # Create a list of nils of the total width
        row = List.duplicate(nil, total_width)

        # Fill in the terms at the appropriate positions
        disjunct
        |> Enum.with_index()
        |> Enum.reduce(row, fn {{ast, negated}, term_idx}, row ->
          pos = start_pos + term_idx
          ref = Map.fetch!(ast_to_ref, deparse(ast))
          term = if negated, do: {:not, ref}, else: ref
          List.replace_at(row, pos, term)
        end)
      end)

    {disjuncts, subexpressions}
  end

  defp calc_start_positions(widths) do
    widths
    |> Enum.reduce({[], 0}, fn width, {positions, acc} ->
      {positions ++ [acc], acc + width}
    end)
    |> elem(0)
  end

  defp build_subexpressions(internal_dnf) do
    internal_dnf
    |> List.flatten()
    |> Enum.map(fn {ast, _negated} -> ast end)
    |> Enum.reduce({%{}, %{}}, fn ast, {ast_to_ref, subexpressions} ->
      key = deparse(ast)

      case Map.fetch(ast_to_ref, key) do
        {:ok, _ref} -> {ast_to_ref, subexpressions}

        :error ->
          ref = make_ref()
          {Map.put(ast_to_ref, key, ref), Map.put(subexpressions, ref, ast)}
      end
    end)
  end

  # Convert AST node back to SQL string for deduplication
  defp deparse(ast) do
    %PgQuery.ParseResult{
      stmts: [
        %PgQuery.RawStmt{
          stmt: %PgQuery.Node{
            node:
              {:select_stmt,
               %PgQuery.SelectStmt{
                 target_list: [%PgQuery.Node{node: {:res_target, %PgQuery.ResTarget{val: ast}}}]
               }}
          }
        }
      ]
    }
    |> PgQuery.protobuf_to_query!()
    |> String.replace_prefix("SELECT ", "")
    |> String.trim()
  end
end
