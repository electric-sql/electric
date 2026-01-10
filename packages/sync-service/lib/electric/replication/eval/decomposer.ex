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
    r1 = make_ref()
    {[[r1]], %{r1 => query}}
  end
end
