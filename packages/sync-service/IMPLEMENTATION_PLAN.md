# Implementation Plan: Arbitrary Boolean Expressions with Subqueries

## Executive Summary

This plan implements RFC "Arbitrary Boolean Expressions with Subqueries" which extends Electric's subquery support from single `IN (SELECT ...)` conditions to arbitrary boolean expressions with OR, NOT, and multiple subqueries. The implementation introduces DNF-based decomposition, per-row `active_conditions` arrays, and position-based move-in/move-out broadcasts.

RFC: ../../docs/rfcs/arbitrary-boolean-expressions-with-subqueries.md

## Key Architectural Constraint: Do Not Modify the Shape Struct

The `Shape` struct (`lib/electric/shapes/shape.ex`) is a primitive in Electric — it is used everywhere, serialized across boundaries, and embedded in many subsystems. **No new fields should be added to `Shape`.**

Instead, all DNF-related state (decomposition, position-to-dependency mappings, negated positions) is held in a separate `DnfContext` struct that lives in `Consumer.State`. The `DnfContext` is computed from the `Shape` and its dependencies at consumer startup time and is passed explicitly to functions that need it.

### DnfContext (`lib/electric/shapes/consumer/dnf_context.ex`)

A new module that encapsulates all DNF decomposition state:

```elixir
defmodule Electric.Shapes.Consumer.DnfContext do
  defstruct [
    decomposition: nil,                # %Decomposer.decomposition{} - the DNF result
    position_to_dependency_map: %{},   # %{position => dep_handle}
    dependency_to_positions_map: %{},  # %{dep_handle => [position]} - reverse lookup
    negated_positions: MapSet.new()    # positions where condition is negated (NOT IN)
  ]

  @doc "Build from a Shape and its dependency mappings. Returns nil if not needed."
  def from_shape(shape)

  @doc "Which DNF positions does this dependency handle affect?"
  def get_positions_for_dependency(ctx, dep_handle)

  @doc "Is this position negated (NOT IN)?"
  def position_negated?(ctx, position)

  @doc "Does this context have a valid DNF with subqueries?"
  def has_valid_dnf?(ctx)

  @doc "Compute active_conditions for a record against the DNF."
  def compute_active_conditions(ctx, record, used_refs, extra_refs)
end
```

This keeps the `Shape` struct lean while giving the consumer everything it needs to process DNF-aware move-in/move-out operations. The `DnfContext` is computed once and stored in `Consumer.State`, passed to `move_handling`, `change_handling`, `subquery_moves`, and `querying` as needed. Functions that currently reach into `shape.dnf_decomposition` or `shape.position_to_dependency_map` should instead accept the `DnfContext` (or `nil` for non-DNF shapes).

Re-decomposition should be avoided: `Decomposer.decompose/1` should be called once in `DnfContext.from_shape/1` and the result cached on the struct. Other call sites (subquery_moves, querying, etc.) should receive the decomposition from the `DnfContext` rather than re-running the decomposer.

## Current State Analysis

### Key Files and Their Roles

| File | Current Role | Changes Needed |
|------|--------------|----------------|
| `lib/electric/shapes/consumer/dnf_context.ex` | **(new)** | Holds DNF decomposition state, built from Shape |
| `lib/electric/shapes/shape/subquery_moves.ex` | Tag structure generation, move-out messages, move-in WHERE clause + exclusion clauses | Extend for DNF positions, DNF-aware exclusion clauses, accept DnfContext |
| `lib/electric/shapes/consumer/state.ex` | Detects `or_with_subquery?`/`not_with_subquery?` to invalidate | Remove invalidation flags, hold DnfContext |
| `lib/electric/shapes/consumer.ex` | Triggers invalidation on OR/NOT with subqueries | Handle multiple positions |
| `lib/electric/shapes/consumer/move_handling.ex` | Single-subquery move-in/out processing | Per-position broadcasts, use DnfContext |
| `lib/electric/shapes/consumer/change_handling.ex` | Filters changes, computes tags | Compute `active_conditions` via DnfContext |
| `lib/electric/shapes/shape.ex` | `fill_move_tags`, `convert_change` | Multi-disjunct tags — **no new struct fields** |
| `lib/electric/shapes/where_clause.ex` | `includes_record?` boolean check | Per-position evaluation |
| `lib/electric/shapes/querying.ex` | SQL for initial data, tags | Add `active_conditions` columns, accept DnfContext |
| `lib/electric/log_items.ex` | Formats messages with tags | Add `active_conditions` to headers |
| `lib/electric/replication/eval/parser.ex` | Parses WHERE, handles SubLinks | No changes needed |
| `lib/electric/replication/eval/walker.ex` | AST traversal | No changes needed |
| `packages/elixir-client/.../tag_tracker.ex` | Client-side tag tracking, DNF eval, synthetic deletes | Slash-delimited normalization, `removed_tags` parsing, position-based indexing |
| `packages/elixir-client/.../message/headers.ex` | Client message headers | Add `active_conditions` field |

### Current Limitations Being Addressed

1. **Lines 291-293 in `consumer.ex`**: Shape invalidation on OR/NOT with subqueries
2. **Lines 145-146 in `consumer/state.ex`**: `or_with_subquery?` and `not_with_subquery?` flags
3. **Single tag structure**: `tag_structure` is `[[column_name]]` - single disjunct
4. **No `active_conditions`**: Client cannot determine which conditions are satisfied

---

## Implementation Steps

### Phase 1: DNF Decomposer (New Module)

**Create** `lib/electric/replication/eval/decomposer.ex`

```elixir
defmodule Electric.Replication.Eval.Decomposer do
  @moduledoc """
  Converts WHERE clause AST to Disjunctive Normal Form (DNF).

  DNF is a disjunction (OR) of conjunctions (AND) of literals.
  Each literal is either a positive or negated atomic condition.
  """

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Walker

  @type position :: non_neg_integer()
  @type literal :: {position(), :positive | :negated}
  @type conjunction :: [literal()]
  @type dnf :: [conjunction()]

  @type subexpression :: %{
    ast: Parser.tree_part(),
    is_subquery: boolean(),
    negated: boolean()
  }

  @type decomposition :: %{
    disjuncts: dnf(),
    subexpressions: %{position() => subexpression()},
    position_count: non_neg_integer()
  }

  @spec decompose(Parser.tree_part()) :: {:ok, decomposition()} | {:error, term()}
  def decompose(ast) do
    # Implementation:
    # 1. Collect all atomic conditions (subqueries + field comparisons)
    # 2. Apply De Morgan's laws to push NOT inward
    # 3. Distribute AND over OR to get DNF
    # 4. Assign positions to each unique atomic condition
    # 5. Return disjuncts as position references
  end
end
```

**Key Functions**:
- `decompose/1` - Main entry point
- `push_negation_inward/1` - De Morgan's laws
- `distribute_and_over_or/1` - DNF conversion
- `collect_atomics/1` - Extract atomic conditions
- `assign_positions/1` - Map conditions to positions

### Phase 2: DnfContext and Shape Tag Structure

**Create** `lib/electric/shapes/consumer/dnf_context.ex` (see "Key Architectural Constraint" above)

**Modify** `lib/electric/shapes/shape.ex` — **no new struct fields**

1. Update `fill_tag_structure/1` to produce multi-disjunct tag structures using the decomposer. The tag_structure field already exists on Shape and is the right place for this — it's the pattern used to hash column values into tags. For DNF shapes it becomes a list of lists (one per disjunct) instead of a single list:
```elixir
defp fill_tag_structure(shape) do
  case shape.where do
    nil -> shape
    where ->
      {:ok, decomposition} = Decomposer.decompose(where.eval)

      # Build tag_structure as list of lists (one per disjunct)
      tag_structure = build_tag_structure_from_dnf(decomposition)

      %{shape | tag_structure: tag_structure}
  end
end
```

2. Update `fill_move_tags/4` for multi-disjunct tags:
```elixir
def fill_move_tags(%Changes.NewRecord{record: record} = change, shape, stack_id, shape_handle) do
  tags = Enum.map(shape.tag_structure, fn disjunct_pattern ->
    Enum.map(disjunct_pattern, fn
      nil -> nil  # Position not in this disjunct
      column_spec -> hash_column_value(column_spec, record, stack_id, shape_handle)
    end)
  end)

  %{change | move_tags: tags}
end
```

**Build DnfContext in Consumer.State init:**
```elixir
# In consumer/state.ex or consumer.ex init
dnf_context = DnfContext.from_shape(shape)
%State{state | dnf_context: dnf_context}
```

All DNF decomposition state (position maps, negated positions, etc.) lives on `dnf_context`, not on the Shape struct.

### Phase 3: Active Conditions Computation

**Modify** `lib/electric/shapes/where_clause.ex`

`compute_active_conditions` is called via `DnfContext.compute_active_conditions/4` which delegates here. The decomposition is passed in from the DnfContext, not read from the Shape.

```elixir
defmodule Electric.Shapes.WhereClause do
  @doc """
  Compute active_conditions array for a record.
  Returns list of **effective** booleans, one per position in the DNF.
  For negated positions, the stored AST is the un-negated form, so we
  apply NOT here to produce the value clients can use directly without
  needing polarity information.
  The decomposition is passed from DnfContext, not from the Shape struct.
  """
  @spec compute_active_conditions(Decomposer.decomposition(), map(), map(), map()) :: [boolean()]
  def compute_active_conditions(decomposition, record, used_refs, extra_refs) do
    %{subexpressions: subexpressions} = decomposition

    Enum.map(0..(map_size(subexpressions) - 1), fn position ->
      subexpr = Map.fetch!(subexpressions, position)
      value = evaluate_subexpression(subexpr, record, used_refs, extra_refs)
      # Apply negation so active_conditions stores the effective value.
      if subexpr.negated, do: not value, else: value
    end)
  end

  @doc """
  Evaluate DNF to determine if record is included.
  active_conditions stores effective values (negation already applied),
  so we always check for true regardless of polarity.
  """
  @spec evaluate_dnf([boolean()], [[{integer(), :positive | :negated}]]) :: boolean()
  def evaluate_dnf(active_conditions, disjuncts) do
    Enum.any?(disjuncts, fn conjunction ->
      Enum.all?(conjunction, fn {pos, _polarity} ->
        Enum.at(active_conditions, pos, false) == true
      end)
    end)
  end
end
```

### Phase 4: Change Handling Updates

**Modify** `lib/electric/shapes/consumer/change_handling.ex`

Uses `state.dnf_context` (from `Consumer.State`) to compute active conditions and evaluate DNF inclusion. Per the RFC ("Replication Stream Updates"), `compute_active_conditions` should replace the separate `includes_record?` call — a single pass, not double evaluation.

```elixir
def do_process_changes([change | rest], %State{shape: shape, dnf_context: dnf_context} = state, ctx, acc, count) do
  # Compute active_conditions for this change via DnfContext
  active_conditions = DnfContext.compute_active_conditions(dnf_context, change.record, used_refs, ctx.extra_refs)

  # Evaluate DNF to check inclusion
  included = WhereClause.evaluate_dnf(
    active_conditions,
    dnf_context.decomposition.disjuncts
  )

  if included do
    change_with_conditions = %{change | active_conditions: active_conditions}

    case Shape.convert_change(shape, change_with_conditions, opts) do
      [] -> do_process_changes(rest, state, ctx, acc, count)
      [converted] ->
        state = State.track_change(state, ctx.xid, converted)
        do_process_changes(rest, state, ctx, [converted | acc], count + 1)
    end
  else
    do_process_changes(rest, state, ctx, acc, count)
  end
end
```

### Phase 5: Move-in/Move-out Message Format + DNF-Aware Exclusion Clauses

**Modify** `lib/electric/shapes/shape/subquery_moves.ex`

> **IMPORTANT — exclusion clause logic lives here.** `move_in_where_clause/4` already
> generates the WHERE clause for move-in queries, including exclusion clauses that prevent
> duplicate inserts when a row is already in the shape via another disjunct. The existing
> index-based exclusion (`build_exclusion_clauses`) is **wrong for AND+OR combinations** —
> it excludes ALL other subquery dependencies by index, but should only exclude dependencies
> in disjuncts that do NOT contain the triggering dependency. For example, in
> `(x IN sq1 AND y IN sq2) OR z IN sq3`, when sq1 triggers, the old code excludes both sq2
> and sq3, but sq2 should NOT be excluded since it's in the same disjunct as sq1.
>
> Replace `build_exclusion_clauses` with `build_dnf_exclusion_clauses` that uses the
> decomposition to partition disjuncts into containing/not-containing the trigger position,
> and only generates `AND NOT (...)` for disjuncts not containing it.

#### 5a: DNF-aware exclusion clauses in `move_in_where_clause`

```elixir
def move_in_where_clause(shape, shape_handle, move_ins, opts) do
  # ... existing code to find index, target_section, handle remove_not ...

  # Build exclusion clauses for other subqueries to avoid duplicate inserts
  # when a row is already in the shape via another disjunct
  exclusion_clauses =
    case shape.where && Decomposer.decompose(shape.where.eval) do
      {:ok, %{disjuncts: disjuncts} = decomposition} when length(disjuncts) > 1 ->
        build_dnf_exclusion_clauses(decomposition, shape_dependencies, comparison_expressions, index)
      _ ->
        ""
    end

  # ... rest of function, appending exclusion_clauses to the query ...
end

# Build exclusion clauses using DNF decomposition.
# Only excludes subqueries in disjuncts that do NOT contain the triggering dependency.
# For example, in `(x IN sq1 AND y IN sq2) OR z IN sq3`:
#   - When sq1 triggers, sq2 is in the same disjunct so NOT excluded; sq3 IS excluded
defp build_dnf_exclusion_clauses(decomposition, shape_dependencies, comparison_expressions, trigger_dep_index) do
  trigger_position = find_dnf_position_for_dep_index(decomposition, trigger_dep_index)

  if is_nil(trigger_position) do
    ""
  else
    # Partition disjuncts into those containing vs not containing the trigger
    {_containing, not_containing} =
      Enum.split_with(decomposition.disjuncts, fn conjunction ->
        Enum.any?(conjunction, fn {pos, _polarity} -> pos == trigger_position end)
      end)

    # Generate exclusion for each disjunct NOT containing the trigger
    clauses =
      Enum.flat_map(not_containing, fn conjunction ->
        case generate_disjunct_exclusion(conjunction, decomposition, shape_dependencies, comparison_expressions) do
          nil -> []
          clause -> [clause]
        end
      end)

    Enum.join(clauses)
  end
end

# Generate an exclusion clause for a single disjunct (conjunction of literals).
# Returns nil if the disjunct contains any non-subquery positions (weaker exclusion
# is safe since the client deduplicates via tags).
# Otherwise returns " AND NOT (cond1 AND cond2 AND ...)"
defp generate_disjunct_exclusion(conjunction, decomposition, shape_dependencies, comparison_expressions) do
  all_subquery? = Enum.all?(conjunction, fn {pos, _polarity} ->
    case Map.get(decomposition.subexpressions, pos) do
      %{is_subquery: true} -> true
      _ -> false
    end
  end)

  if not all_subquery? do
    nil
  else
    conditions = Enum.flat_map(conjunction, fn {pos, polarity} ->
      info = Map.get(decomposition.subexpressions, pos)
      case extract_sublink_index_from_ast(info.ast) do
        nil -> []
        dep_index ->
          subquery_shape = Enum.at(shape_dependencies, dep_index)
          subquery_section = rebuild_subquery_section(subquery_shape)
          column_sql = get_column_sql(comparison_expressions, dep_index)
          if column_sql do
            condition = "#{column_sql} #{subquery_section}"
            case polarity do
              :positive -> [condition]
              :negated -> ["NOT #{condition}"]
            end
          else
            []
          end
      end
    end)

    if conditions == [], do: nil, else: " AND NOT (#{Enum.join(conditions, " AND ")})"
  end
end
```

> **TODO (DnfContext pass-through):** The above calls `Decomposer.decompose(shape.where.eval)`
> directly. Once DnfContext is threaded through to `move_in_where_clause` (Phase 9), replace
> with `dnf_context.decomposition` to avoid re-decomposition. See Risk #5.

#### 5b: Move-in/move-out control messages with position information

```elixir
@doc """
Generate move-in control message with position information.
"""
def make_move_in_control_message(shape, stack_id, shape_handle, position, values) do
  hashed_values = Enum.map(values, fn value ->
    make_value_hash(stack_id, shape_handle, value)
  end)

  %{
    headers: %{
      control: "move-in",
      position: position,
      values: hashed_values
    }
  }
end

@doc """
Generate move-out control message with position information.
"""
def make_move_out_control_message(shape, stack_id, shape_handle, position, values) do
  hashed_values = Enum.map(values, fn {_key, value} ->
    make_value_hash(stack_id, shape_handle, value)
  end)

  %{
    headers: %{
      control: "move-out",
      position: position,
      values: hashed_values
    }
  }
end
```

### Phase 6: Log Items Format

**Modify** `lib/electric/log_items.ex`

```elixir
def from_change(%Changes.NewRecord{} = change, txids, _, _replica) do
  headers = %{
    operation: :insert,
    txids: List.wrap(txids),
    relation: Tuple.to_list(change.relation),
    lsn: to_string(change.log_offset.tx_offset),
    op_position: change.log_offset.op_offset
  }
  |> put_if_true(:last, change.last?)
  |> put_if_true(:tags, change.move_tags != [], change.move_tags)
  |> put_if_true(:active_conditions, change.active_conditions != nil, change.active_conditions)

  [{change.log_offset, %{key: change.key, value: change.record, headers: headers}}]
end
```

### Phase 7: Querying Updates for Initial Snapshot

**Modify** `lib/electric/shapes/querying.ex`

> **IMPORTANT — dual tag format:** `querying.ex` generates tags for two different consumers:
> (1) wire/API tags sent to clients (slash-delimited per-disjunct via `make_tags`), and
> (2) snapshot file tags used internally for `moved_out_tags` filtering (flat per-position
> via `make_snapshot_tags` — see Phase 12). `query_move_in/5` must use `make_snapshot_tags`,
> not `make_tags`, otherwise `moved_out_tags` filtering silently breaks for multi-disjunct
> shapes because bare hashes never match slash-delimited strings.

```elixir
defp build_active_conditions_select(dnf_context) do
  case dnf_context do
    nil -> ""
    %DnfContext{decomposition: %{subexpressions: subexpressions}} ->
      conditions = Enum.map(0..(map_size(subexpressions) - 1), fn pos ->
        subexpr = Map.fetch!(subexpressions, pos)
        sql = sql_for_subexpression(subexpr)
        # For negated positions, wrap in NOT to produce the effective condition
        # value. The decomposer stores the un-negated AST with negated=true,
        # so we must apply the negation here to match the Elixir-side semantics
        # in compute_active_conditions/4.
        if subexpr.negated, do: "(NOT #{sql})", else: sql
      end)

      ", ARRAY[#{Enum.join(conditions, ", ")}]::boolean[] as active_conditions"
  end
end

defp build_headers_part({schema, table}, additional_headers, tags, active_conditions_sql) do
  # Include active_conditions in headers JSON
  # ...
end
```

### Phase 8: Consumer State Updates

**Modify** `lib/electric/shapes/consumer/state.ex`

Remove invalidation flags and add `dnf_context`:

```elixir
defstruct [
  # ... existing fields ...
  # REMOVE: or_with_subquery?: false,
  # REMOVE: not_with_subquery?: false,
  # ADD:
  dnf_context: nil,  # %DnfContext{} - built from shape at init time
]
```

The `DnfContext` holds all position-to-dependency mappings, negated position tracking, and the decomposition itself. No per-position state is added to `Shape` or `Consumer.State` directly — it all lives on the `DnfContext`.

### Phase 9: Move Handling for Multiple Positions

**Modify** `lib/electric/shapes/consumer/move_handling.ex`

> **IMPORTANT:** This phase changes how move-in/move-out events are processed, but does NOT
> update the `moved_out_tags` filtering that prevents stale query results. That is Phase 12,
> which MUST also be implemented — without it, `moved_out_tags` compares bare hashes against
> slash-delimited tag strings and never matches, silently allowing stale rows through.

Uses `state.dnf_context` for position lookups and negation checks. Delegates WHERE clause
generation (including DNF-aware exclusion clauses) to `SubqueryMoves.move_in_where_clause/4`
— see Phase 5a. This module handles the **orchestration** (which positions to activate/deactivate,
when to query vs broadcast), not the SQL generation.

```elixir
def process_move_ins(%State{dnf_context: dnf_context} = state, dep_handle, new_values) do
  # Find which positions this dependency affects via DnfContext
  positions = DnfContext.get_positions_for_dependency(dnf_context, dep_handle)

  # Separate negated from positive positions
  negated_positions = Enum.filter(positions, &DnfContext.position_negated?(dnf_context, &1))
  positive_positions = positions -- negated_positions

  state =
    if negated_positions != [] do
      # Move-in to subquery = deactivation of NOT IN condition → move-out
      broadcast_deactivation(state, negated_positions, new_values)
    else
      state
    end

  if positive_positions != [] do
    # Move-in to subquery = activation of IN condition → query for new rows
    # SubqueryMoves.move_in_where_clause handles DNF-aware exclusion (Phase 5a)
    formed_where_clause = SubqueryMoves.move_in_where_clause(shape, dep_handle, values)
    do_move_in_with_where(state, dep_handle, new_values, formed_where_clause)
  else
    state
  end
end

def process_move_outs(%State{dnf_context: dnf_context} = state, dep_handle, removed_values) do
  positions = DnfContext.get_positions_for_dependency(dnf_context, dep_handle)

  negated_positions = Enum.filter(positions, &DnfContext.position_negated?(dnf_context, &1))
  positive_positions = positions -- negated_positions

  state =
    if positive_positions != [] do
      # Move-out from subquery = deactivation of IN condition → broadcast move-out
      broadcast_deactivation(state, positive_positions, removed_values)
    else
      state
    end

  if negated_positions != [] do
    # Move-out from subquery = activation of NOT IN condition → query for new rows
    # Pass remove_not: true to strip NOT from the WHERE clause
    formed_where_clause = SubqueryMoves.move_in_where_clause(shape, dep_handle, values, remove_not: true)
    do_move_in_with_where(state, dep_handle, removed_values, formed_where_clause)
  else
    state
  end
end
```

### Phase 10: Remove Shape Invalidation

**Modify** `lib/electric/shapes/consumer.ex`

Use `DnfContext.has_valid_dnf?/1` instead of the removed `or_with_subquery?`/`not_with_subquery?` flags to decide whether to handle move-in/move-out or invalidate:

```elixir
def handle_info({:materializer_changes, dep_handle, %{move_in: move_in, move_out: move_out}}, state) do
  feature_flags = Electric.StackConfig.lookup(state.stack_id, :feature_flags, [])
  tagged_subqueries_enabled? = "tagged_subqueries" in feature_flags

  # REMOVE the invalidation logic for OR/NOT - DnfContext handles it
  if not tagged_subqueries_enabled? do
    stop_and_clean(state)
  else
    {state, notification} =
      state
      |> MoveHandling.process_move_ins(dep_handle, move_in)
      |> MoveHandling.process_move_outs(dep_handle, move_out)

    notify_new_changes(state, notification)
    {:noreply, state}
  end
end
```

### Phase 11: Elixir Client Updates

The Elixir client (`packages/elixir-client`) is our example client implementation and is used
in the integration tests. It must handle the new wire format (slash-delimited tags,
`active_conditions`, position-based move-in/move-out) correctly.

**Modify** `packages/elixir-client/lib/electric/client/tag_tracker.ex`

1. **Slash-delimited tag normalization**: Tags arrive as slash-delimited strings
   (e.g., `"hash1/hash2/"`, `"//hash3"`). Normalize to 2D arrays internally:
   `["hash1/", "/hash2"]` → `[["hash1", nil], [nil, "hash2"]]`

2. **`removed_tags` normalization**: `removed_tags` arrive in the **same slash-delimited
   format** as `tags`. They must be normalized through the same split pipeline before
   comparison against internal position hashes. Without this, `filter_removed_tags` compares
   bare hashes against raw slash-delimited strings — never matches.

3. **DNF-based visibility evaluation**: `row_visible?/2` evaluates OR over disjuncts, where
   each disjunct is AND over non-null `active_conditions` positions.

4. **Position-based `tag_to_keys` index**: Index by `{position, hash_value}` tuples for
   efficient move-in/move-out lookups.

5. **Move-out synthetic deletes**: `generate_synthetic_deletes/4` deactivates positions
   matching `{pos, value}` patterns and generates deletes only when no disjunct evaluates
   to true.

6. **Move-in activation**: `handle_move_in/4` activates positions for matching keys.

```elixir
# Key normalization — removed_tags must use the same pipeline as tags
removed_tags_set =
  removed_tags
  |> normalize_tags()
  |> Enum.flat_map(fn disjunct -> Enum.reject(disjunct, &is_nil/1) end)
  |> MapSet.new()
```

**Modify** `packages/elixir-client/lib/electric/client/message/headers.ex`

- Add `active_conditions` field to `Headers` struct
- Parse `active_conditions` from incoming messages in `from_message/2`

**Tests**: `packages/elixir-client/test/electric/client/tag_tracker_test.exs`

```elixir
describe "tag_tracker with DNF wire format" do
  test "normalizes slash-delimited tags to 2D structure"
  test "removed_tags in slash-delimited format are correctly filtered"
  test "row_visible? evaluates DNF correctly"
  test "generate_synthetic_deletes only deletes when all disjuncts unsatisfied"
  test "handle_move_in activates correct positions"
  test "position-based tag_to_keys index for multi-disjunct shapes"
end
```

### Phase 12: Position-aware `moved_out_tags` (Snapshot Tag Format + Filtering)

**CRITICAL — correctness requirement, not optional.** Without this phase, move-out filtering
is silently broken for all multi-disjunct shapes. The existing `moved_out_tags` mechanism
(which prevents stale move-in query results from entering the log) compares bare hashes
against the tags stored in snapshot files. When Phase 2 changes tags to slash-delimited
per-disjunct strings, the comparison **never matches** — bare `"hash(a)"` vs slash-delimited
`"hash(a)/"` — so stale rows silently leak through. Additionally, position-unaware filtering
is semantically wrong: a move-out at position 0 should not affect position 1 even if both
positions contain the same hash.

This phase has two parts:

#### Part 1: Snapshot file tags become per-position flat hashes

**Modify** `lib/electric/shapes/querying.ex`

The wire/API tags (sent to clients in JSON headers) remain slash-delimited per-disjunct —
unchanged. But snapshot file tags (used internally for `moved_out_tags` filtering) use a
**different, flat format**: one hash per DNF position, no delimiters.

Add `make_snapshot_tags/3` alongside the existing `make_tags/3`:

```elixir
# make_tags:          [[x, y], [nil, z]] → ["md5(x) || '/' || md5(y)", "'' || '/' || md5(z)"]
# make_snapshot_tags: [[x, y], [nil, z]] → ["md5(x)", "md5(y)", "''", "md5(z)"]
defp make_snapshot_tags(%Shape{tag_structure: tag_structure}, stack_id, shape_handle) do
  escaped_prefix = escape_sql_string(to_string(stack_id) <> to_string(shape_handle))

  tag_structure
  |> List.flatten()
  |> Enum.map(fn
    nil -> "''"
    column_name when is_binary(column_name) ->
      col = pg_cast_column_to_text(column_name)
      namespaced = pg_namespace_value_sql(col)
      ~s[md5('#{escaped_prefix}' || #{namespaced})]
    {:hash_together, columns} ->
      column_parts =
        Enum.map(columns, fn col_name ->
          col = pg_cast_column_to_text(col_name)
          ~s['#{col_name}:' || #{pg_namespace_value_sql(col)}]
        end)
      ~s[md5('#{escaped_prefix}' || #{Enum.join(column_parts, " || ")})]
  end)
end
```

`query_move_in/5` must use `make_snapshot_tags` (not `make_tags`):

```elixir
tag_select = make_snapshot_tags(shape, stack_id, shape_handle) |> Enum.join(", ")
```

#### Part 2: `moved_out_tags` becomes position-aware

**Modify** `lib/electric/shapes/consumer/move_ins.ex`

Change the type from `%{name => MapSet}` to `%{name => {position, MapSet}}`:

```elixir
@type t() :: %__MODULE__{
  moved_out_tags: %{move_in_name() => {non_neg_integer(), MapSet.t(String.t())}}
}

def add_waiting(state, name, moved_values, position) do
  # ... existing logic ...
  moved_out_tags: Map.put(state.moved_out_tags, name, {position, MapSet.new()})
end

def move_out_happened(state, position, new_tags) do
  moved_out_tags =
    Map.new(state.moved_out_tags, fn {name, {pos, tags}} ->
      if pos == position do
        {name, {pos, MapSet.union(tags, new_tags)}}
      else
        {name, {pos, tags}}
      end
    end)
  %{state | moved_out_tags: moved_out_tags}
end
```

**Modify** `lib/electric/shapes/consumer/move_handling.ex`

Pass position through to `add_waiting` and `move_out_happened`:

```elixir
# Move-in: derive position from DnfContext
position = List.first(positions, 0)
MoveIns.add_waiting(state.move_handling_state, name, moved_values, position)

# Move-out: extract position from control message patterns
position = List.first(message.headers.patterns, %{})[:pos] || 0
MoveIns.move_out_happened(state.move_handling_state, position, new_tags)

# Default when no moved_out_tags entry exists
state.move_handling_state.moved_out_tags[name] || {0, MapSet.new()}
```

**Modify** `lib/electric/shape_cache/storage.ex` — update type spec:

```elixir
tags_to_skip :: {non_neg_integer(), MapSet.t(String.t())}
```

**Modify** `lib/electric/shape_cache/pure_file_storage.ex` and `in_memory_storage.ex`

Replace `all_parents_moved_out?/2` with position-aware filtering:

```elixir
defp should_skip_for_moved_out?(tags, {position, tags_to_skip}) do
  case Enum.at(tags, position) do
    nil -> false
    "" -> false
    hash -> MapSet.member?(tags_to_skip, hash)
  end
end
```

Bump `@version` from 1 → 2 in `pure_file_storage.ex` to invalidate old-format snapshots.

#### Why this is easy to miss

This phase fixes the **interaction** between new multi-disjunct tag formats (Phase 2) and
pre-existing race-condition filtering in the storage layer. Each piece works correctly in
isolation — the bug only manifests when slash-delimited tags are compared against bare
hashes at filtering time. No test will catch this unless it specifically exercises the
move-out-while-move-in-in-flight race condition with a multi-disjunct shape.

#### Files changed

- `querying.ex` — add `make_snapshot_tags/3`, use in `query_move_in/5`
- `move_ins.ex` — change `moved_out_tags` type, update `add_waiting/4` and `move_out_happened/3`
- `move_handling.ex` — derive position from DnfContext/patterns, pass through
- `storage.ex` — update `tags_to_skip` type in behaviour spec
- `pure_file_storage.ex` — replace `all_parents_moved_out?` with `should_skip_for_moved_out?`, bump `@version`
- `in_memory_storage.ex` — same filtering change
- `storage_implementations_test.exs` — test position-aware filtering

#### Known limitation

`List.first(positions, 0)` picks only the first position when a `dep_handle` maps to
multiple positions. Wrong for shapes like `WHERE x IN sq AND x NOT IN sq` (same subquery
in both positive and negated form). Low practical risk. Fix: thread the already-known
position through instead of re-deriving.

---

## Test Strategy

### Unit Tests

#### 1. DNF Decomposer Tests (`test/electric/replication/eval/decomposer_test.exs`)

```elixir
describe "decompose/1" do
  test "simple AND - single conjunction" do
    # WHERE x IN subquery AND y = 1
    # Expected: [[{0, :positive}, {1, :positive}]]
  end

  test "simple OR - multiple disjuncts" do
    # WHERE x IN subquery1 OR y IN subquery2
    # Expected: [[{0, :positive}], [{1, :positive}]]
  end

  test "NOT with subquery" do
    # WHERE x NOT IN subquery
    # Expected: [[{0, :negated}]]
  end

  test "De Morgan's law - NOT (A AND B)" do
    # WHERE NOT (x IN sq1 AND y IN sq2)
    # Expected: [[{0, :negated}], [{1, :negated}]]
  end

  test "De Morgan's law - NOT (A OR B)" do
    # WHERE NOT (x IN sq1 OR y IN sq2)
    # Expected: [[{0, :negated}, {1, :negated}]]
  end

  test "complex mixed expression" do
    # WHERE (x IN sq1 AND status='active') OR y IN sq2
    # Expected: [[{0, :positive}, {1, :positive}], [{2, :positive}]]
  end

  test "nested NOT - double negation" do
    # WHERE NOT NOT (x IN subquery)
    # Expected: [[{0, :positive}]]
  end
end
```

#### 2. Active Conditions Tests (`test/electric/shapes/where_clause_test.exs`)

```elixir
describe "compute_active_conditions/3" do
  test "all conditions true" do
    # Given: x='a', sq1 contains 'a', status='active'
    # Expected: [true, true]
  end

  test "mixed true/false conditions" do
    # Given: x='a', sq1 contains 'a', sq2 does NOT contain 'b'
    # Expected: [true, false]
  end

  test "negated position inverts result" do
    # Given: x='a', sq1 contains 'a' (negated position)
    # Expected: active_conditions[0] = false (because NOT IN fails)
  end
end

describe "evaluate_dnf/2" do
  test "OR - any disjunct true means included" do
    # active_conditions: [true, false]
    # disjuncts: [[{0, :positive}], [{1, :positive}]]
    # Expected: true (first disjunct satisfied)
  end

  test "AND - all literals in conjunction must be true" do
    # active_conditions: [true, false]
    # disjuncts: [[{0, :positive}, {1, :positive}]]
    # Expected: false (second literal fails)
  end
end
```

### Integration Tests (`test/electric/plug/subquery_router_test.exs`)

#### 3. Basic OR with Subqueries

```elixir
describe "OR with subqueries" do
  setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
  setup :with_complete_stack

  @tag with_sql: [
    "INSERT INTO projects (id, active) VALUES ('p1', true)",
    "INSERT INTO users (id, admin) VALUES ('u1', true)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', null)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t2', null, 'u1')",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t3', 'p2', 'u2')"
  ]
  test "initial snapshot includes rows matching either condition", ctx do
    # WHERE project_id IN (active projects) OR assigned_to IN (admin users)
    # t1 matches first condition, t2 matches second, t3 matches neither
  end

  test "tags have correct structure for multiple disjuncts", ctx do
    # Verify tags: [[hash(project_id), null], [null, hash(assigned_to)]]
  end

  test "active_conditions array included in response", ctx do
    # Verify headers include active_conditions: [true, false] etc.
  end
end
```

#### 4. NOT with Subqueries

```elixir
describe "NOT with subqueries" do
  @tag with_sql: [
    "INSERT INTO archived_projects (id) VALUES ('p1')",
    "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')",
    "INSERT INTO tasks (id, project_id) VALUES ('t2', 'p2')"
  ]
  test "NOT IN excludes rows when value in subquery", ctx do
    # WHERE project_id NOT IN (SELECT id FROM archived_projects)
    # t1 excluded (p1 is archived), t2 included
  end

  test "move-in to NOT IN subquery triggers move-out", ctx do
    # Insert 'p2' into archived_projects
    # t2 should receive synthetic delete
  end

  test "move-out from NOT IN subquery triggers move-in", ctx do
    # Delete 'p1' from archived_projects
    # t1 should be queried and sent to client
  end
end
```

#### 5. Move-in Without Query (Row Already Present)

```elixir
describe "move-in without Postgres query" do
  @tag with_sql: [
    "INSERT INTO projects (id, active) VALUES ('p1', false)",
    "INSERT INTO users (id, admin) VALUES ('u1', true)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
  ]
  test "no query when row already in shape for another disjunct", ctx do
    # t1 is in shape because assigned_to IN (admin users)
    # Activate p1's project -> move-in for first disjunct
    # Should broadcast only, not query Postgres for t1
  end

  test "active_conditions updates without new insert message", ctx do
    # Verify client receives move-in broadcast
    # t1's active_conditions changes from [false, true] to [true, true]
    # No duplicate insert for t1
  end
end
```

#### 6. Move-out with Row Still In Shape

```elixir
describe "move-out with row still in shape" do
  @tag with_sql: [
    "INSERT INTO projects (id, active) VALUES ('p1', true)",
    "INSERT INTO users (id, admin) VALUES ('u1', true)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
  ]
  test "row stays when one disjunct deactivates but another satisfied", ctx do
    # t1 matches both disjuncts
    # Deactivate p1's project -> first disjunct false
    # Row stays because second disjunct (admin user) still true
  end

  test "row removed only when all disjuncts false", ctx do
    # Deactivate p1's project AND remove u1 from admins
    # Now t1 matches neither disjunct -> synthetic delete
  end
end
```

#### 7. Complex Expressions

```elixir
describe "complex boolean expressions" do
  test "nested AND within OR" do
    # WHERE (project_id IN sq1 AND status = 'active') OR assigned_to IN sq2
  end

  test "De Morgan: NOT (A AND B)" do
    # WHERE NOT (project_id IN sq1 AND status = 'active')
    # Equivalent to: project_id NOT IN sq1 OR status != 'active'
  end

  test "De Morgan: NOT (A OR B)" do
    # WHERE NOT (project_id IN sq1 OR assigned_to IN sq2)
    # Equivalent to: project_id NOT IN sq1 AND assigned_to NOT IN sq2
  end

  test "mixed positive and negated at same position" do
    # WHERE x IN sq1 OR x NOT IN sq1
    # Always true, but tests position handling
  end
end
```

#### 8. Protocol Versioning

```elixir
describe "protocol versioning" do
  test "v1 clients rejected for complex WHERE with OR subqueries", ctx do
    # Request with protocol v1 header
    # WHERE with OR and subqueries
    # Should return 400 error
  end

  test "v2 clients accepted for complex WHERE", ctx do
    # Same request with protocol v2
    # Should succeed
  end

  test "simple single-subquery works with v1", ctx do
    # Backward compatibility for existing shapes
  end
end
```

#### 9. Edge Cases

```elixir
describe "edge cases" do
  test "NULL values in subquery columns" do
    # Row with NULL project_id
    # NULL IN (...) is always NULL/false
  end

  test "empty subquery results" do
    # Subquery returns no rows
    # IN empty = false, NOT IN empty = true
  end

  test "concurrent move-ins at different positions" do
    # Two dependency shapes change simultaneously
  end

  test "shape restart preserves position mapping" do
    # Verify deterministic position assignment
  end
end
```

---

## Order of Operations

```
Phase 1: DNF Decomposer
    |
    v
Phase 1.5: DnfContext (depends on Phase 1)
    |
    v
Phase 2: Shape tag_structure + fill_move_tags (depends on Phase 1, NO new Shape fields)
    |
    +---> Phase 2.5: Protocol Validation (depends on Phase 2)
    |
    +---> Phase 3: Active Conditions (depends on Phase 1.5)
    |         |
    |         +---> Phase 4: Change Handling (depends on Phase 3, uses DnfContext)
    |         |
    |         +---> Phase 6: Log Items (depends on Phase 3 for active_conditions)
    |
    +---> Phase 5: Move Messages (depends on Phase 2)
              |
              v
          Phase 7: Querying (depends on Phases 5, 6, uses DnfContext for decomposition)

Phase 8: Consumer State — holds DnfContext (can be parallel with Phases 3-7)
    |
    v
Phase 9: Move Handling (depends on Phases 5, 8, uses DnfContext)
    |
    +---> Phase 10: Remove Invalidation (depends on Phase 9)
    |
    +---> Phase 12: Position-aware moved_out_tags (depends on Phases 2, 7, 9)
          ^^^ REQUIRED for correctness — without this, moved_out_tags filtering
              is silently broken for multi-disjunct shapes

Phase 11: Elixir Client (depends on Phases 5, 6 for wire format definition)
```

**Recommended Implementation Order**:
1. Phase 1 (Decomposer) - foundational, no dependencies
2. Phase 1.5 (DnfContext) - wraps decomposer output, provides query API for consumers
3. Phase 2 (Shape tag_structure + fill_move_tags) - uses decomposer, **no new Shape struct fields**
4. Phase 8 (Consumer State) - holds DnfContext, built at init
5. Phase 3 (Active Conditions) - uses DnfContext
6. Phase 5 (Move Messages) - independent of Phase 3/4
7. Phase 6 (Log Items) - uses new message format
8. Phase 4 (Change Handling) - uses DnfContext for active conditions, replaces includes_record?
9. Phase 7 (Querying) - uses DnfContext for decomposition, avoids re-decomposing
10. Phase 9 (Move Handling) - uses DnfContext for position lookups
11. **Phase 12 (Position-aware moved_out_tags) - MUST follow Phase 9 immediately; fixes tag format mismatch in storage filtering**
12. Phase 10 (Remove Invalidation) - final cleanup
13. Phase 11 (Elixir Client) - must handle new wire format; used by integration tests

---

## Gaps and Risks

### Technical Risks

1. **DNF Explosion**: Complex WHERE clauses can produce exponentially many disjuncts
   - Mitigation: Add a complexity guard — reject shapes where `length(disjuncts) > 100` with a descriptive error at shape creation time
   - Document reasonable limits (~10 subqueries)

2. **Position Stability**: If positions change between shape restarts, clients will have stale `active_conditions`
   - Mitigation: Position assignment must be deterministic (sort by AST traversal order)

3. **Concurrent Move-ins**: Multiple positions activating simultaneously
   - Mitigation: Use existing snapshot-based ordering mechanism
   - Test: Add integration tests for concurrent scenarios

4. **NOT IN Edge Cases**: `NULL` handling in NOT IN is tricky in SQL
   - Mitigation: Follow PostgreSQL semantics exactly
   - Test: Include NULL value tests

5. **Avoid re-decomposition**: `Decomposer.decompose/1` must be called once in `DnfContext.from_shape/1` and the result passed through. Do not re-decompose at other call sites (subquery_moves, querying, etc.) — accept the decomposition from DnfContext instead.

6. **Single-pass active_conditions**: Per the RFC, `compute_active_conditions` should *replace* the `includes_record?` call — not run alongside it. Avoid double evaluation in the replication stream path.

7. **ast_to_sql completeness**: Any AST-to-SQL converter for snapshot queries must have a fallback clause for unsupported operators. Missing operators should raise a descriptive error at shape creation time, not crash at query time.

8. **Snapshot tag format vs wire tag format (Phase 12)**: Changing the wire tag format to slash-delimited strings (Phase 2) silently breaks the pre-existing `moved_out_tags` filtering in the storage layer, because it compares bare hashes against slash-delimited strings. This is an **integration-level correctness bug** that won't surface in unit tests — it requires a multi-disjunct shape with a move-out racing a move-in query. Phase 12 must be implemented immediately after Phase 9 (Move Handling) to fix this. See Phase 12 in the Implementation Steps for details.

### Protocol Compatibility

1. **V1 Clients**: Must reject complex WHERE clauses for v1 protocol
   - Implementation: Add protocol version check in shape validation
   - Return 400 error with descriptive message

2. **Message Format**: New `active_conditions` field is additive
   - V1 clients will ignore unknown fields (safe)
   - V2 clients must handle missing `active_conditions` (for simple shapes)

### Performance Considerations

1. **Active Conditions Computation**: Done per-row in replication stream
   - Profile: Measure overhead vs current `includes_record?`
   - Optimize: Cache subquery results per transaction

2. **Tag Storage**: Multiple disjuncts = larger tags array
   - Profile: Measure storage overhead
   - Consider: Sparse representation if many positions

3. **Move-in Queries**: "Not in other disjuncts" clause may be expensive
   - Profile: EXPLAIN ANALYZE on typical queries
   - Optimize: Index recommendations for common patterns

---

## Critical Files for Implementation

- `lib/electric/shapes/consumer/dnf_context.ex` - **(new)** DNF state container, built from Shape
- `lib/electric/shapes/shape/subquery_moves.ex` - Core tag and move message generation, **move-in WHERE clause + DNF-aware exclusion clauses**
- `lib/electric/shapes/shape.ex` - `fill_move_tags`, `tag_structure` — **no new struct fields**
- `lib/electric/shapes/consumer/move_handling.ex` - Move-in/out orchestration (position routing, negation inversion), delegates SQL generation to `subquery_moves.ex`
- `lib/electric/shapes/where_clause.ex` - Record filtering and `active_conditions`
- `lib/electric/log_items.ex` - Message format with `active_conditions`
- `lib/electric/shapes/querying.ex` - SQL generation for snapshots, accepts DnfContext
- `packages/elixir-client/lib/electric/client/tag_tracker.ex` - Client-side tag tracking, DNF evaluation, synthetic deletes
- `packages/elixir-client/lib/electric/client/message/headers.ex` - Client message header parsing

---

## Review Addendum: Addressing Identified Gaps

This section addresses gaps identified during plan review.

### A. Move-in Query Exclusion Logic (NOT other_disjuncts)

Per RFC lines 230-246, move-in queries must exclude rows already sent via other disjuncts.

**Implementation in Phase 5** (in `subquery_moves.ex`, not `move_handling.ex`):

The exclusion clause SQL is generated inside `move_in_where_clause/4` in `subquery_moves.ex`,
which is the function that builds the complete WHERE clause for move-in queries. See Phase 5a
for the full implementation of `build_dnf_exclusion_clauses` and `generate_disjunct_exclusion`.

Key points:
- Uses `Decomposer.decompose` to find the trigger's DNF position
- Partitions disjuncts into containing/not-containing the trigger position
- Only generates `AND NOT (...)` for disjuncts NOT containing the trigger
- Skips exclusion for disjuncts containing non-subquery positions (safe — client deduplicates via tags)
- Each excluded disjunct becomes `AND NOT (cond1 AND cond2 AND ...)` respecting polarity

`move_handling.ex` calls `SubqueryMoves.move_in_where_clause` and passes the result to
the query executor — it does NOT generate exclusion SQL itself.

### B. Negation Tracking Flow

Negation flows through the system as follows:

1. **Decomposer** extracts atomic conditions and tracks which are negated:
   ```elixir
   # For "x NOT IN (SELECT ...)"
   %{subexpressions: %{
     0 => %{ast: sublink_ast, is_subquery: true, column: "x", negated: true}
   }}
   ```

2. **DnfContext** aggregates negated positions (in `DnfContext.from_shape/1`):
   ```elixir
   defp extract_negated_positions(decomposition) do
     decomposition.subexpressions
     |> Enum.filter(fn {_pos, subexpr} -> subexpr.negated end)
     |> Enum.map(fn {pos, _} -> pos end)
     |> MapSet.new()
   end
   ```

3. **Move handling** inverts behavior for negated positions:
   - Move-in to subquery + negated position = **deactivation** (NOT IN now false)
   - Move-out from subquery + negated position = **activation** (NOT IN now true)

4. **Same value at multiple positions** (e.g., `x IN sq OR x NOT IN sq`):
   ```elixir
   # Positions: 0 (positive), 1 (negated)
   # Row with x='a' where 'a' is in subquery:
   tags: [[hash(a), nil], [nil, hash(a)]]  # Same hash, different positions
   active_conditions: [true, false]  # Opposite values
   ```

### C. `changes_only` Mode Handling

Add to Phase 6 and Phase 4:

```elixir
# In change_handling.ex - changes_only mode includes same data as full sync
def process_change_for_changes_only(change, shape, ctx) do
  # Compute tags and active_conditions identically to snapshot mode
  active_conditions = compute_active_conditions(change, shape, ctx.extra_refs)
  tags = Shape.compute_tags(shape, change.record, ctx.stack_id, ctx.shape_handle)

  # Include in change headers
  %{change |
    active_conditions: active_conditions,
    move_tags: tags
  }
end
```

**Client behavior in `changes_only` mode:**
- Clients build state incrementally
- Move-in/move-out broadcasts for unknown rows are **ignored** (row not in local state)
- Tags and `active_conditions` on insert/update/delete are processed normally

### D. Protocol Version Check

Add new **Phase 2.5: Protocol Validation**:

```elixir
# In lib/electric/shapes/api.ex or shape validation
# DnfContext is built early enough to use here, or pass the decomposition directly.
defp validate_protocol_compatibility(dnf_context, protocol_version) do
  has_complex_subqueries? = dnf_context != nil and
    DnfContext.has_valid_dnf?(dnf_context) and
    (length(dnf_context.decomposition.disjuncts) > 1 or
     MapSet.size(dnf_context.negated_positions) > 0)

  cond do
    protocol_version == 1 and has_complex_subqueries? ->
      {:error, :protocol_version_too_low,
        "WHERE clauses with OR or NOT combined with subqueries require protocol version 2. " <>
        "Please upgrade your client."}

    true ->
      :ok
  end
end
```

**Protocol version detection:**
- Client sends `Electric-Protocol-Version: 2` header
- Server checks before shape creation
- Returns 400 with descriptive error for v1 clients with complex shapes

### E. Message Format Migration

**Current format** (single-subquery, flat):
```json
{"tags": ["hash1/hash2"], "event": "move-out", "patterns": [{"pos": 0, "value": "hash"}]}
```

**New format** (multi-disjunct, nested):
```json
{"tags": [["hash1", "hash2", null]], "active_conditions": [true, true, false]}
{"control": "move-out", "position": 0, "values": ["hash1", "hash2"]}
```

**Migration strategy:**
1. Feature flag `dnf_subqueries` controls new format
2. Single-subquery shapes with flag disabled continue using flat format
3. When flag enabled, all shapes use nested format
4. Clients must be updated before enabling flag in production

### F. Struct Changes Required

**Modify `lib/electric/replication/changes.ex`:**

```elixir
defmodule Electric.Replication.Changes.NewRecord do
  defstruct [
    # ... existing fields ...
    :move_tags,           # [[hash | nil]] - nested array per disjunct
    :active_conditions,   # [boolean] - one per position
    :removed_tags         # [[hash | nil]] - for updates only
  ]
end

defmodule Electric.Replication.Changes.UpdatedRecord do
  defstruct [
    # ... existing fields ...
    :move_tags,
    :active_conditions,
    :removed_tags  # Tags from old record that no longer apply
  ]
end

defmodule Electric.Replication.Changes.DeletedRecord do
  defstruct [
    # ... existing fields ...
    :move_tags,  # Tags at time of deletion (for client cleanup)
    :active_conditions
  ]
end
```

### G. Dependency Handle to Position Mapping

**Built inside `DnfContext.from_shape/1`** — not on the Shape struct:

```elixir
# Inside DnfContext.from_shape/1
defp build_position_to_dependency_map(decomposition, dep_handles) do
  decomposition.subexpressions
  |> Enum.filter(fn {_pos, subexpr} -> subexpr.is_subquery end)
  |> Enum.map(fn {pos, subexpr} ->
    dep_handle = find_matching_dependency_handle(subexpr, dep_handles)
    {pos, dep_handle}
  end)
  |> Map.new()
end

# DnfContext also builds the reverse map
defp build_dependency_to_positions_map(pos_to_dep) do
  Enum.group_by(pos_to_dep, fn {_pos, handle} -> handle end, fn {pos, _} -> pos end)
end

# Used by move_handling.ex via DnfContext.get_positions_for_dependency/2
```

**Note:** Same subquery can appear at multiple positions (e.g., `x IN sq AND y IN sq`).

### H. Position Stability Algorithm

**Deterministic position assignment:**

```elixir
def assign_positions(atomics) do
  # Sort atomics by their AST string representation for determinism
  atomics
  |> Enum.sort_by(fn atomic ->
    # Use a canonical string representation
    :erlang.term_to_binary(atomic.ast)
  end)
  |> Enum.with_index()
  |> Enum.map(fn {atomic, idx} -> {idx, atomic} end)
  |> Map.new()
end
```

This ensures the same WHERE clause always produces the same position assignments across shape restarts.

---

## Additional Test Coverage

### Snapshot Positioning Tests

```elixir
describe "snapshot positioning for move-in queries" do
  test "move-in query runs in REPEATABLE READ isolation" do
    # Verify transaction isolation level
  end

  test "pg_current_snapshot captured and used for filtering" do
    # Insert row, start move-in query, insert another row during query
    # Second row should not appear in move-in results (filtered by snapshot)
  end

  test "touch tracking prevents duplicate rows" do
    # Row modified in stream after move-in query started
    # Move-in query returns that row
    # Stream change should be used, query result skipped
  end

  test "move-in results positioned correctly relative to stream" do
    # Move-in query completes while stream has concurrent changes
    # Results should appear at correct log offset
  end
end
```

### Resume and `changes_only` Mode Tests

```elixir
describe "resume with active_conditions" do
  test "resumed stream includes active_conditions on changes" do
    # Get initial data, disconnect, reconnect with resume
    # Verify subsequent changes include active_conditions
  end

  test "move-out during disconnect generates synthetic delete on resume" do
    # Disconnect, deactivate a disjunct, reconnect
    # Should receive synthetic delete
  end
end

describe "changes_only mode with DNF" do
  test "inserts include tags and active_conditions" do
    # Start with changes_only, insert row
    # Verify headers include both
  end

  test "updates include tags, removed_tags, and active_conditions" do
    # changes_only mode, update that changes tag-relevant column
    # Verify all three headers present
  end

  test "move-in broadcasts for unknown rows are handled gracefully" do
    # changes_only client receives move-in for row not in local state
    # Should ignore without error
  end
end
```

### `removed_tags` Tests

```elixir
describe "removed_tags on updates" do
  test "update changing tag-relevant column includes removed_tags" do
    # Row with project_id='p1', update to project_id='p2'
    # Should include removed_tags with hash(p1)
  end

  test "update not changing tag-relevant column has empty removed_tags" do
    # Row with project_id='p1', update value column
    # removed_tags should be empty or absent
  end

  test "update changing multiple tag-relevant columns" do
    # Row with project_id='p1', assigned_to='u1'
    # Update both columns
    # removed_tags should include both old hashes
  end
end
```

### Additional Edge Cases

```elixir
describe "additional edge cases" do
  test "same subquery referenced at multiple positions" do
    # WHERE x IN sq1 OR y IN sq1
    # Single dependency affects two positions
    # Move-in should handle both positions
  end

  test "DNF complexity guard" do
    # Extremely complex WHERE clause
    # Should return error before explosion
  end

  test "double negation simplification" do
    # WHERE NOT NOT (x IN sq)
    # Should simplify to positive position
  end

  test "tautology detection" do
    # WHERE x IN sq OR x NOT IN sq
    # Should recognize as always-true (optional optimization)
  end
end
```

---

## Revised Order of Operations

```
Phase 1: DNF Decomposer
    |
    v
Phase 1.5: DnfContext (depends on Phase 1)
    |
    v
Phase 2: Shape tag_structure + fill_move_tags (depends on Phase 1, NO new Shape fields)
    |
    +---> Phase 2.5: Protocol Validation (depends on Phase 2)
    |
    +---> Phase 3: Active Conditions (depends on Phase 1.5)
    |         |
    |         +---> Phase 4: Change Handling (depends on Phase 3, uses DnfContext)
    |         |
    |         +---> Phase 6: Log Items (depends on Phase 3 for active_conditions)
    |
    +---> Phase 5: Move Messages (depends on Phase 2)
              |
              v
          Phase 7: Querying (depends on Phases 5, 6, uses DnfContext for decomposition)

Phase 8: Consumer State — holds DnfContext (can be parallel with Phases 3-7)
    |
    v
Phase 9: Move Handling (depends on Phases 5, 8, uses DnfContext)
    |
    +---> Phase 10: Remove Invalidation (depends on Phase 9)
    |
    +---> Phase 12: Position-aware moved_out_tags (depends on Phases 2, 7, 9)
          ^^^ REQUIRED for correctness — without this, moved_out_tags filtering
              is silently broken for multi-disjunct shapes

Phase 11: Elixir Client (depends on Phases 5, 6 for wire format definition)
```

---

## Migration Checklist

Before enabling `dnf_subqueries` feature flag in production:

1. [ ] All clients updated to handle nested tag format
2. [ ] All clients updated to handle `active_conditions` field
3. [ ] All clients updated to handle position-based move-in/move-out messages
4. [ ] Protocol version negotiation implemented and tested
5. [ ] Existing shapes will continue working (backward compatibility verified)
6. [ ] Performance profiling completed for:
   - [ ] `compute_active_conditions` overhead
   - [ ] Multi-disjunct tag storage size
   - [ ] Move-in exclusion query performance
7. [ ] Shape handle invalidation strategy decided (if needed)

---

### Remaining Work

1. **Protocol Version Validation** (Optional)
   - Add protocol version check to reject complex shapes for v1 clients
   - This is optional since v1 clients can still work by ignoring unknown fields
