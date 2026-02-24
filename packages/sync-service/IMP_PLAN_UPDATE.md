# Plan: Materialized-State Exclusion Clauses

## Context

The current implementation of move-in exclusion clauses uses **live Postgres subqueries** (`AND NOT (col IN (SELECT ...))`). When two dependencies change in the same transaction, each exclusion query sees the other's committed changes and both exclude the row — it's never delivered. The PLAN_UPDATE.md describes the fix: replace live subqueries with **parameter-based exclusion** (`= ANY($values)`) using materialized state, with a seen/unseen protocol to choose the correct snapshot of each dependency's values.

## Architecture Summary

- **Materializer** (`materializer.ex`): GenServer per dependency shape, tracks `value_counts` (value -> count). Sends `{:materializer_changes, handle, events}` to consumer.
- **Consumer** (`consumer.ex`): Receives `materializer_changes` via `handle_info`. Each dependency sends a separate message. Materializers in layer 0 process before the outer consumer in layer 1.
- **SubqueryMoves** (`subquery_moves.ex`): `build_dnf_exclusion_clauses/4` generates `AND NOT (col IN (SELECT ...))` using `rebuild_subquery_section/1`. **This is the broken code.**
- **MoveHandling** (`move_handling.ex`): `do_start_move_in_query/3` calls `SubqueryMoves.move_in_where_clause/4`.

## Key Ordering Guarantee

For transaction T, ShapeLogCollector dispatches to shapes in layer order. Layer 0 (dependency) consumers process T first, materializers update and `send(pid, {:materializer_changes, ...})` to the outer consumer. The outer consumer's `handle_event` for T arrives after. Since `send` is FIFO and `handle_call`/`handle_info` share the same mailbox, the consumer processes materializer_changes for T **before** its own `do_handle_txn` for T. This lets us reset `seen_deps` inside `do_handle_txn`.

---

## Changes

### 1. Materializer — add `prev_value_counts`

**File:** `lib/electric/shapes/consumer/materializer.ex`

**1a.** Add `prev_value_counts: %{}` to state in `init/1` (after line 103).

**1b.** In `apply_changes_and_notify/2` (line 295), save current `value_counts` as `prev_value_counts` before calling `apply_changes`:

```elixir
defp apply_changes_and_notify(changes, state) do
  state = %{state | prev_value_counts: state.value_counts}
  {state, events} = apply_changes(changes, state)
  # ... rest unchanged
end
```

Do NOT save `prev_value_counts` in `handle_continue({:read_stream, ...})` — those are startup reads with no consumer listening.

**1c.** Add `get_prev_link_values/1` public API + handler (alongside existing `get_link_values`). Same return type (`MapSet` of parsed values). No catch/raise — let GenServer.call exit naturally:

```elixir
def get_prev_link_values(opts) do
  GenServer.call(name(opts), :get_prev_link_values)
end

def handle_call(:get_prev_link_values, _from, %{prev_value_counts: pvc} = state) do
  {:reply, MapSet.new(Map.keys(pvc)), state}
end
```

No `_as_strings` variants needed. String conversion happens downstream in `build_exclusion_context` (step 4) using `Eval.Env.const_to_pg_string` and the type info from `shape.where.used_refs`.

### 2. Consumer State — add `seen_deps` tracking

**File:** `lib/electric/shapes/consumer/state.ex`

Add to `defstruct` (line 31):
```elixir
seen_deps: MapSet.new()
```

Add helpers:
```elixir
def mark_dep_seen(state, dep_handle),
  do: %{state | seen_deps: MapSet.put(state.seen_deps, dep_handle)}

def dep_seen?(state, dep_handle),
  do: MapSet.member?(state.seen_deps, dep_handle)

def reset_seen_deps(state),
  do: %{state | seen_deps: MapSet.new()}
```

### 3. Consumer — wire seen_deps into the flow

**File:** `lib/electric/shapes/consumer.ex`

**3a.** In `handle_info({:materializer_changes, dep_handle, ...})` (line 276), mark dep as seen **before** processing:

```elixir
state = State.mark_dep_seen(state, dep_handle)
```

**3b.** In `do_handle_txn/2` (line 497), reset seen_deps at the start:

```elixir
defp do_handle_txn(%Transaction{xid: xid, changes: changes} = txn, state) do
  state = State.reset_seen_deps(state)
  # ... rest unchanged
```

### 4. MoveHandling — fetch exclusion values and pass to SubqueryMoves

**File:** `lib/electric/shapes/consumer/move_handling.ex`

**4a.** In `do_start_move_in_query/3` (line 190), build exclusion context and pass as 5th arg:

```elixir
exclusion_context = build_exclusion_context(state, dep_handle)

formed_where_clause =
  SubqueryMoves.move_in_where_clause(
    state.shape, dep_handle, Enum.map(values, &elem(&1, 1)),
    state.dnf_context, exclusion_context
  )
```

**4b.** Add `build_exclusion_context/2`. Fetches materialized values (as parsed Elixir values via `get_link_values`/`get_prev_link_values`), then converts to PG strings using `Eval.Env.const_to_pg_string` with type info from `shape.where.used_refs`:

```elixir
defp build_exclusion_context(%State{dnf_context: nil}, _), do: nil

defp build_exclusion_context(%State{} = state, trigger_dep_handle) do
  used_refs = state.shape.where.used_refs

  dep_values =
    state.shape.shape_dependencies_handles
    |> Enum.with_index()
    |> Enum.reject(fn {handle, _} -> handle == trigger_dep_handle end)
    |> Map.new(fn {handle, index} ->
      opts = %{shape_handle: handle, stack_id: state.stack_id}
      parsed_values =
        if State.dep_seen?(state, handle),
          do: Materializer.get_link_values(opts),
          else: Materializer.get_prev_link_values(opts)

      # Convert parsed values to PG strings for SQL parameters
      ref_type = used_refs[["$sublink", Integer.to_string(index)]]
      strings = values_to_strings(parsed_values, ref_type)
      {index, strings}
    end)

  %{dep_values: dep_values}
end

# Convert a MapSet of parsed values to a list of PG string representations.
# Matches the format expected by `= ANY($N::text[]::type[])` params.
defp values_to_strings(parsed_values, {:array, {:row, types}}) do
  Enum.map(parsed_values, fn tuple ->
    tuple
    |> Tuple.to_list()
    |> Enum.zip_with(types, &Eval.Env.const_to_pg_string(Eval.Env.new(), &1, &2))
    |> List.to_tuple()
  end)
end

defp values_to_strings(parsed_values, {:array, type}) do
  Enum.map(parsed_values, &Eval.Env.const_to_pg_string(Eval.Env.new(), &1, type))
end
```

This keeps SubqueryMoves free of GenServer calls — all values are pre-fetched and pre-converted.

### 5. SubqueryMoves — replace live subquery exclusion with parameterized exclusion

**File:** `lib/electric/shapes/shape/subquery_moves.ex`

**5a.** Update `move_in_where_clause/4` signature to accept optional 5th arg:

```elixir
def move_in_where_clause(shape, shape_handle, move_ins, dnf_context, exclusion_context \\ nil)
```

**5b.** Pass `exclusion_context` through to `build_dnf_move_in_where`.

**5c.** In `build_dnf_move_in_where` (line 128-141), replace the exclusion clause generation:

```elixir
# BEFORE: always uses live subqueries
exclusion = build_dnf_exclusion_clauses(decomposition, shape.shape_dependencies, ...)

# AFTER: use materialized values when context provided
{exclusion_sql, exclusion_params} =
  if length(decomposition.disjuncts) > 1 and exclusion_context != nil do
    build_materialized_exclusion_clauses(
      decomposition, shape, trigger_dep_index,
      exclusion_context, length(params) + 1
    )
  else
    {"", []}
  end

{base_where <> exclusion_sql, params ++ exclusion_params}
```

**5d.** New function `build_materialized_exclusion_clauses/5`:

Same structure as `build_dnf_exclusion_clauses` — partitions disjuncts into containing/not-containing the trigger, generates exclusion for non-containing. But instead of `rebuild_subquery_section/1` (live subquery), generates `column = ANY($N::text[]::type[])` using the pre-fetched values from `exclusion_context.dep_values`.

Key changes from `generate_disjunct_exclusion`:
- Look up `dep_index` via `extract_sublink_index(info.ast)` (same as current)
- Look up pre-fetched values: `exclusion_context.dep_values[dep_index]`
- Get type from `shape.where.used_refs[["$sublink", "#{dep_index}"]]`
- Generate: `column = ANY($N::text[]::type[])` with the values as a SQL parameter
- Track parameter index, incrementing for each exclusion dependency
- Return `{sql_fragment, params_list, next_param_index}`

**5e.** Keep `build_dnf_exclusion_clauses/4` as fallback (not used for move-in queries, but may be useful for other contexts or tests). Can mark as `@doc false` or remove if confirmed unused.

### 6. Edge Cases

| Case | Behavior |
|------|----------|
| Single-dependency shape | `length(disjuncts) > 1` is false → no exclusion generated. No change. |
| Empty materialized values | `= ANY(ARRAY[]::type[])` matches nothing → no exclusion fires → row passes through. Correct. |
| Dep has no changes in this txn | prev == current (no mutation) → either works. |
| Mixed subquery/non-subquery disjunct | `all_subquery?` check returns false → `nil` → client deduplicates via tags. Same as before. |
| Async query timing | WHERE clause + params are bound at construction time. Materializer changes later don't affect in-flight queries. |
| Composite keys (row type) | Use `IN (SELECT * FROM unnest($N::text[]::type[], ...))`. Same pattern as `build_trigger_replacement`. |

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/electric/shapes/consumer/materializer.ex` | Add `prev_value_counts`, `get_prev_link_values` |
| `lib/electric/shapes/consumer/state.ex` | Add `seen_deps` field + helpers |
| `lib/electric/shapes/consumer.ex` | Mark seen, reset seen_deps |
| `lib/electric/shapes/consumer/move_handling.ex` | Build exclusion context, pass to SubqueryMoves |
| `lib/electric/shapes/shape/subquery_moves.ex` | New `build_materialized_exclusion_clauses`, update `move_in_where_clause` |

## Verification

1. **Unit tests** for materializer `prev_value_counts`:
   - `get_prev_link_values` returns empty before runtime changes
   - Returns pre-change state after a batch of changes
   - Not updated during initial stream read (startup)

2. **Unit tests** for `build_materialized_exclusion_clauses`:
   - Generates `= ANY($N::text[]::type[])` syntax (not live subqueries)
   - Parameter indices are correctly incremented
   - Empty values produce valid SQL

3. **Integration test** for the two-dependency same-transaction scenario:
   - Shape: `WHERE x IN (SELECT ...) OR y IN (SELECT ...)`
   - Single transaction inserts x1 into dep_X and y1 into dep_Y
   - Row `{x: x1, y: y1}` appears exactly once (not zero, not twice)

4. **Run existing test suite**: `mix test` in sync-service — existing tests should pass since single-dependency shapes still skip exclusion.

## Implementation Order

1. Materializer changes (self-contained, testable independently)
2. Consumer State changes (trivial struct addition)
3. Consumer handle_info/do_handle_txn changes (wire seen_deps)
4. MoveHandling changes (build + pass exclusion context)
5. SubqueryMoves changes (core exclusion clause rewrite)
6. Tests
