# LIKE/ILIKE operators not supported as functions in WHERE clauses for subset queries

## Context

A customer is using TanStack DB with on-demand `syncMode` and Electric and ran into errors when using `LIKE`/`ILIKE` operators in their WHERE clauses. While TanStack DB fixed their side of the issue in https://github.com/TanStack/db/pull/884, the underlying problem in Electric still remains.

## Problem Description

When using `LIKE` or `ILIKE` operators in WHERE clauses for subset queries, users encounter the following error:

```
unknown or unsupported function ilike/2
```

or

```
unknown or unsupported function like/2
```

### Example Query That Fails

```elixir
subset: %{where: "value ILIKE $1", params: %{"1" => "%test%"}}
```

### Expected Behavior

The query should work successfully, as `LIKE` and `ILIKE` are standard PostgreSQL pattern matching operators that are widely used.

### Actual Behavior

The query fails with an "unknown or unsupported function" error, even though the operators themselves are supported in Electric.

## Root Cause Analysis

Electric currently defines `LIKE` and `ILIKE` **only as operators** in the known functions registry:

**File:** `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex`

```elixir
defpostgres("text ~~ text -> bool", delegate: &Casting.like?/2)    # Line 88
defpostgres("text ~~* text -> bool", delegate: &Casting.ilike?/2)  # Line 89
```

However, in PostgreSQL, `LIKE` and `ILIKE` can be represented in multiple ways:

1. **As operators** (`~~`, `~~*`) - This is what Electric currently supports
2. **As function calls** (`like(text, text)`, `ilike(text, text)`) - This is NOT currently supported

The PgQuery parser (which Electric uses to parse WHERE clauses) may choose to represent `LIKE`/`ILIKE` as function calls in certain contexts, particularly in subset queries. When this happens, Electric's parser looks for these in the functions registry, not the operators registry, and fails to find them.

### Evidence in the Code

The error originates from the function lookup path in the parser:

**File:** `packages/sync-service/lib/electric/replication/eval/parser.ex` (around line 1066)

```elixir
defp find_available_functions(%PgQuery.FuncCall{} = call, %{funcs: funcs}) do
  name = identifier(call.funcname)
  arity = length(call.args)

  case Map.fetch(funcs, {name, arity}) do
    {:ok, options} -> {:ok, options}
    :error -> {:error, {call.location, "unknown or unsupported function #{name}/#{arity}"}}
  end
end
```

The parser correctly handles `LIKE`/`ILIKE` when they appear as `A_Expr` nodes with kind `:AEXPR_LIKE` or `:AEXPR_ILIKE` (lines 691-692):

```elixir
# LIKE and ILIKE are expressed plainly as operators by the parser
{:AEXPR_LIKE, _} -> handle_binary_operator(expr, env)
{:AEXPR_ILIKE, _} -> handle_binary_operator(expr, env)
```

But when PgQuery represents them as `FuncCall` nodes, the lookup fails because no function definitions exist.

## Test Case Evidence

There's already a passing test that uses `ILIKE` with subset queries:

**File:** `packages/sync-service/test/electric/plug/router_test.exs` (line 2710)

```elixir
subset: %{where: "value ILIKE $1", params: %{"1" => "%2"}}
```

This test likely passes because in this specific context, PgQuery represents the `ILIKE` as an operator expression rather than a function call. However, the behavior is not consistent across all query patterns.

## Proposed Solution

Add function definitions for `LIKE` and `ILIKE` to complement the existing operator definitions:

**File:** `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex`

```elixir
# Add after the existing operator definitions (around line 90)

# LIKE/ILIKE as functions (in addition to operators ~~, ~~*)
defpostgres("like(text, text) -> bool", delegate: &Casting.like?/2)
defpostgres("ilike(text, text) -> bool", delegate: &Casting.ilike?/2)
```

This would allow Electric to handle `LIKE`/`ILIKE` whether PgQuery represents them as:
- Operators (`A_Expr` with `~~`/`~~*`) ✅ Already works
- Functions (`FuncCall` with `like`/`ilike`) ✅ Would work with this fix

### Why This Works

The implementation function (`&Casting.like?/2` and `&Casting.ilike?/2`) is the same for both the operator and function forms, because they perform identical operations. We're simply registering the same implementation under both the operator name and the function name.

## Additional Context

### PostgreSQL Behavior

In PostgreSQL, `LIKE` and `ILIKE` are indeed syntactic sugar that can be represented as either operators or functions:

- `LIKE` operator → `~~` operator → `textlike` function
- `ILIKE` operator → `~~*` operator → `texticlike` function

The parser may choose either representation depending on the query structure and context.

### Related Code

The `NOT LIKE` and `NOT ILIKE` operators are also defined:

```elixir
defpostgres "text !~~ text -> bool" do
  def not_like?(text1, text2), do: not Casting.like?(text1, text2)
end

defpostgres "text !~~* text -> bool" do
  def not_ilike?(text1, text2), do: not Casting.ilike?(text1, text2)
end
```

These would likely need corresponding function definitions as well for completeness:

```elixir
defpostgres("not_like(text, text) -> bool", delegate: &not_like?/2)
defpostgres("not_ilike(text, text) -> bool", delegate: &not_ilike?/2)
```

## Impact

This is a blocking issue for users who want to use pattern matching in their WHERE clauses for subset queries, which is a common and fundamental SQL operation. The workaround is to avoid using `LIKE`/`ILIKE`, which significantly limits query expressiveness.

## Testing

After implementing the fix, the following should be tested:

1. Direct `LIKE`/`ILIKE` usage in subset WHERE clauses
2. `NOT LIKE`/`NOT ILIKE` operators
3. Case-sensitive vs case-insensitive pattern matching
4. Pattern matching with wildcards (`%`, `_`)
5. Escaped patterns (e.g., `'hell\%'`)
6. Usage with parameterized queries (`$1`, `$2`, etc.)

Existing test at `packages/sync-service/test/electric/plug/router_test.exs:2710` should continue to pass, and additional test cases should be added to cover the function call representation.

## References

- Customer issue: TanStack DB on-demand syncMode with Electric
- TanStack DB fix: https://github.com/TanStack/db/pull/884
- PostgreSQL LIKE documentation: https://www.postgresql.org/docs/current/functions-matching.html
- PgQuery parser behavior: `A_Expr` nodes with `AEXPR_LIKE`/`AEXPR_ILIKE` kinds use operator names `~~`/`~~*`
