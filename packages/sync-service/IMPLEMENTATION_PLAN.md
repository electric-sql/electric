# Implementation Plan: Arbitrary Boolean Expressions with Subqueries

## Executive Summary

This plan implements RFC "Arbitrary Boolean Expressions with Subqueries" which extends Electric's subquery support from single `IN (SELECT ...)` conditions to arbitrary boolean expressions with OR, NOT, and multiple subqueries. The implementation introduces DNF-based decomposition, per-row `active_conditions` arrays, and position-based move-in/move-out broadcasts.

RFC: ../../docs/rfcs/arbitrary-boolean-expressions-with-subqueries.md

## Current State Analysis

### Key Files and Their Roles

| File | Current Role | Changes Needed |
|------|--------------|----------------|
| `lib/electric/shapes/shape/subquery_moves.ex` | Tag structure generation, move-out messages | Extend for DNF positions, active_conditions |
| `lib/electric/shapes/consumer/state.ex` | Detects `or_with_subquery?`/`not_with_subquery?` to invalidate | Remove invalidation flags, support DNF |
| `lib/electric/shapes/consumer.ex` | Triggers invalidation on OR/NOT with subqueries | Handle multiple positions |
| `lib/electric/shapes/consumer/move_handling.ex` | Single-subquery move-in/out processing | Per-position broadcasts |
| `lib/electric/shapes/consumer/change_handling.ex` | Filters changes, computes tags | Compute `active_conditions` |
| `lib/electric/shapes/shape.ex` | `fill_move_tags`, `convert_change` | Multi-disjunct tags, `active_conditions` |
| `lib/electric/shapes/where_clause.ex` | `includes_record?` boolean check | Per-position evaluation |
| `lib/electric/shapes/querying.ex` | SQL for initial data, tags | Add `active_conditions` columns |
| `lib/electric/log_items.ex` | Formats messages with tags | Add `active_conditions` to headers |
| `lib/electric/replication/eval/parser.ex` | Parses WHERE, handles SubLinks | No changes needed |
| `lib/electric/replication/eval/walker.ex` | AST traversal | No changes needed |

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

### Phase 2: Shape Module Updates

**Modify** `lib/electric/shapes/shape.ex`

1. Add new struct fields:
```elixir
defstruct [
  # ... existing fields ...
  dnf_decomposition: nil,        # %Decomposer.decomposition{}
  position_to_column_map: %{},   # %{position => column_name | {:hash_together, [columns]}}
  negated_positions: MapSet.new() # positions where condition is negated
]
```

2. Update `fill_tag_structure/1` to use decomposer:
```elixir
defp fill_tag_structure(shape) do
  case shape.where do
    nil -> shape
    where ->
      {:ok, decomposition} = Decomposer.decompose(where.eval)

      # Build tag_structure as list of lists (one per disjunct)
      tag_structure = build_tag_structure_from_dnf(decomposition)

      %{shape |
        dnf_decomposition: decomposition,
        tag_structure: tag_structure,
        negated_positions: extract_negated_positions(decomposition)
      }
  end
end
```

3. Update `fill_move_tags/4` for multi-disjunct tags:
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

### Phase 3: Active Conditions Computation

**Modify** `lib/electric/shapes/where_clause.ex`

```elixir
defmodule Electric.Shapes.WhereClause do
  @doc """
  Compute active_conditions array for a record.
  Returns list of booleans, one per position in the DNF.
  """
  @spec compute_active_conditions(Expr.t(), map(), map()) :: [boolean()]
  def compute_active_conditions(where_clause, record, extra_refs) do
    %{dnf_decomposition: %{subexpressions: subexpressions}} = where_clause

    Enum.map(0..(map_size(subexpressions) - 1), fn position ->
      subexpr = Map.fetch!(subexpressions, position)
      evaluate_subexpression(subexpr, record, extra_refs)
    end)
  end

  @doc """
  Evaluate DNF to determine if record is included.
  """
  @spec evaluate_dnf([boolean()], [[{integer(), :positive | :negated}]]) :: boolean()
  def evaluate_dnf(active_conditions, disjuncts) do
    Enum.any?(disjuncts, fn conjunction ->
      Enum.all?(conjunction, fn {pos, polarity} ->
        value = Enum.at(active_conditions, pos)
        if polarity == :positive, do: value, else: not value
      end)
    end)
  end
end
```

### Phase 4: Change Handling Updates

**Modify** `lib/electric/shapes/consumer/change_handling.ex`

```elixir
def do_process_changes([change | rest], %State{shape: shape} = state, ctx, acc, count) do
  # Compute active_conditions for this change
  active_conditions = compute_active_conditions_for_change(change, shape, ctx.extra_refs)

  # Evaluate DNF to check inclusion
  included = WhereClause.evaluate_dnf(
    active_conditions,
    shape.dnf_decomposition.disjuncts
  )

  if included do
    # Add active_conditions to change before converting
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

### Phase 5: Move-in/Move-out Message Format

**Modify** `lib/electric/shapes/shape/subquery_moves.ex`

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

```elixir
defp build_active_conditions_select(shape) do
  case shape.dnf_decomposition do
    nil -> ""
    %{subexpressions: subexpressions} ->
      conditions = Enum.map(0..(map_size(subexpressions) - 1), fn pos ->
        subexpr = Map.fetch!(subexpressions, pos)
        sql_for_subexpression(subexpr)
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

Remove invalidation flags and support per-position tracking:

```elixir
defstruct [
  # ... existing fields ...
  # REMOVE: or_with_subquery?: false,
  # REMOVE: not_with_subquery?: false,
  # ADD:
  position_to_dependency_map: %{},  # %{position => dependency_handle}
]
```

### Phase 9: Move Handling for Multiple Positions

**Modify** `lib/electric/shapes/consumer/move_handling.ex`

```elixir
def process_move_ins(%State{} = state, dep_handle, new_values) do
  # Find which positions this dependency affects
  positions = get_positions_for_dependency(state.shape, dep_handle)

  Enum.reduce(positions, state, fn position, acc_state ->
    # For each position, determine if it's a positive or negated reference
    is_negated = MapSet.member?(state.shape.negated_positions, position)

    if is_negated do
      # Move-in to subquery = deactivation of NOT IN condition
      broadcast_deactivation(acc_state, position, new_values)
    else
      # Move-in to subquery = activation of IN condition
      broadcast_activation_and_query(acc_state, position, new_values, dep_handle)
    end
  end)
end

def process_move_outs(%State{} = state, dep_handle, removed_values) do
  positions = get_positions_for_dependency(state.shape, dep_handle)

  Enum.reduce(positions, state, fn position, acc_state ->
    is_negated = MapSet.member?(state.shape.negated_positions, position)

    if is_negated do
      # Move-out from subquery = activation of NOT IN condition
      broadcast_activation_and_query(acc_state, position, removed_values, dep_handle)
    else
      # Move-out from subquery = deactivation of IN condition
      broadcast_deactivation(acc_state, position, removed_values)
    end
  end)
end
```

### Phase 10: Remove Shape Invalidation

**Modify** `lib/electric/shapes/consumer.ex`

```elixir
def handle_info({:materializer_changes, dep_handle, %{move_in: move_in, move_out: move_out}}, state) do
  feature_flags = Electric.StackConfig.lookup(state.stack_id, :feature_flags, [])
  tagged_subqueries_enabled? = "tagged_subqueries" in feature_flags

  # REMOVE the invalidation logic for OR/NOT - now we handle it properly
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
Phase 2: Shape Module (depends on Phase 1)
    |
    +---> Phase 3: Active Conditions (depends on Phase 2)
    |         |
    |         v
    |     Phase 4: Change Handling (depends on Phase 3)
    |
    +---> Phase 5: Move Messages (depends on Phase 2)
              |
              v
          Phase 6: Log Items (depends on Phase 5)
              |
              v
          Phase 7: Querying (depends on Phase 6)

Phase 8: Consumer State (can be parallel with Phases 3-7)
    |
    v
Phase 9: Move Handling (depends on Phases 5, 8)
    |
    v
Phase 10: Remove Invalidation (depends on Phase 9)
```

**Recommended Implementation Order**:
1. Phase 1 (Decomposer) - foundational, no dependencies
2. Phase 2 (Shape) - uses decomposer
3. Phase 3 (Active Conditions) - uses shape changes
4. Phase 5 (Move Messages) - independent of Phase 3/4
5. Phase 6 (Log Items) - uses new message format
6. Phase 4 (Change Handling) - uses active conditions
7. Phase 7 (Querying) - uses all above
8. Phase 8 (Consumer State) - cleanup
9. Phase 9 (Move Handling) - integrates everything
10. Phase 10 (Remove Invalidation) - final cleanup

---

## Gaps and Risks

### Technical Risks

1. **DNF Explosion**: Complex WHERE clauses can produce exponentially many disjuncts
   - Mitigation: Document reasonable limits (~10 subqueries)
   - Consider: Add validation to reject overly complex expressions

2. **Position Stability**: If positions change between shape restarts, clients will have stale `active_conditions`
   - Mitigation: Position assignment must be deterministic (sort by AST traversal order)

3. **Concurrent Move-ins**: Multiple positions activating simultaneously
   - Mitigation: Use existing snapshot-based ordering mechanism
   - Test: Add integration tests for concurrent scenarios

4. **NOT IN Edge Cases**: `NULL` handling in NOT IN is tricky in SQL
   - Mitigation: Follow PostgreSQL semantics exactly
   - Test: Include NULL value tests

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

- `lib/electric/shapes/shape/subquery_moves.ex` - Core tag and move message generation
- `lib/electric/shapes/shape.ex` - Shape struct and `fill_move_tags`
- `lib/electric/shapes/consumer/move_handling.ex` - Move-in/out processing
- `lib/electric/shapes/where_clause.ex` - Record filtering and `active_conditions`
- `lib/electric/log_items.ex` - Message format with `active_conditions`
- `lib/electric/shapes/querying.ex` - SQL generation for snapshots

---

## Review Addendum: Addressing Identified Gaps

This section addresses gaps identified during plan review.

### A. Move-in Query Exclusion Logic (NOT other_disjuncts)

Per RFC lines 230-246, move-in queries must exclude rows already sent via other disjuncts.

**Implementation in Phase 9:**

```elixir
defp build_move_in_query(shape, position, moved_values, dep_handle) do
  # Get the column for this position
  column = get_column_for_position(shape, position)

  # Build the exclusion clause from other disjuncts
  other_disjuncts = shape.dnf_decomposition.disjuncts
    |> Enum.with_index()
    |> Enum.reject(fn {_disjunct, idx} ->
      # Reject disjuncts that include our position
      disjunct_includes_position?(shape, idx, position)
    end)
    |> Enum.map(fn {disjunct, _idx} ->
      build_disjunct_sql(shape, disjunct)
    end)

  exclusion_clause = case other_disjuncts do
    [] -> ""
    clauses -> " AND NOT (#{Enum.join(clauses, " OR ")})"
  end

  # The full query
  """
  SELECT #{columns},
         ARRAY[#{active_conditions_sql}]::boolean[] as active_conditions,
         #{tags_sql} as tags
  FROM #{table}
  WHERE #{column} = ANY($1)
    #{exclusion_clause}
  """
end

defp build_disjunct_sql(shape, disjunct) do
  # Convert a disjunct (conjunction of literals) to SQL
  conditions = Enum.map(disjunct, fn {pos, polarity} ->
    subexpr = Map.fetch!(shape.dnf_decomposition.subexpressions, pos)
    sql = subexpression_to_sql(subexpr)
    if polarity == :negated, do: "NOT (#{sql})", else: sql
  end)

  "(#{Enum.join(conditions, " AND ")})"
end
```

### B. Negation Tracking Flow

Negation flows through the system as follows:

1. **Decomposer** extracts atomic conditions and tracks which are negated:
   ```elixir
   # For "x NOT IN (SELECT ...)"
   %{subexpressions: %{
     0 => %{ast: sublink_ast, is_subquery: true, column: "x", negated: true}
   }}
   ```

2. **Shape struct** aggregates negated positions:
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
defp validate_protocol_compatibility(shape, protocol_version) do
  has_complex_subqueries? = shape.dnf_decomposition != nil and
    (length(shape.dnf_decomposition.disjuncts) > 1 or
     MapSet.size(shape.negated_positions) > 0)

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

**Build during shape creation (Phase 2):**

```elixir
defp build_position_to_dependency_map(shape) do
  shape.dnf_decomposition.subexpressions
  |> Enum.filter(fn {_pos, subexpr} -> subexpr.is_subquery end)
  |> Enum.map(fn {pos, subexpr} ->
    dep_handle = get_or_create_dependency_handle(subexpr.ast)
    {pos, dep_handle}
  end)
  |> Map.new()
end

# Reverse lookup for move handling
defp get_positions_for_dependency(shape, dep_handle) do
  shape.position_to_dependency_map
  |> Enum.filter(fn {_pos, handle} -> handle == dep_handle end)
  |> Enum.map(fn {pos, _} -> pos end)
end
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
Phase 2: Shape Module (depends on Phase 1)
    |
    +---> Phase 2.5: Protocol Validation (depends on Phase 2)
    |
    +---> Phase 3: Active Conditions (depends on Phase 2)
    |         |
    |         +---> Phase 4: Change Handling (depends on Phase 3)
    |         |
    |         +---> Phase 6: Log Items (depends on Phase 3 for active_conditions)
    |
    +---> Phase 5: Move Messages (depends on Phase 2)
              |
              v
          Phase 7: Querying (depends on Phases 5, 6)

Phase 8: Consumer State (can be parallel with Phases 3-7)
    |
    v
Phase 9: Move Handling (depends on Phases 5, 8)
    |
    v
Phase 10: Remove Invalidation (depends on Phase 9)
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

## Implementation Progress (2026-01-28)

### Completed Work

1. **Phase 1: DNF Decomposer** ✅
   - Created `lib/electric/replication/eval/decomposer.ex`
   - Implements DNF conversion with De Morgan's laws
   - Position assignment for atomic expressions
   - Subquery detection and column extraction
   - Full test coverage in `test/electric/replication/eval/decomposer_test.exs`

2. **Phase 2: Shape Module Updates** ✅
   - Added `dnf_decomposition` and `position_to_dependency_map` fields to Shape struct
   - Implemented `compute_dnf_decomposition/2`
   - Implemented `build_position_to_dependency_map/3`
   - Implemented `build_dnf_tag_structure/2` for DNF-aware tags
   - Added `get_positions_for_dependency/2` for reverse dependency lookup
   - Added `position_negated?/2` for checking if position is negated

3. **Phase 3: Active Conditions Computation** ✅
   - Updated `lib/electric/shapes/where_clause.ex` with:
     - `compute_active_conditions/4` - evaluates each atomic subexpression
     - `evaluate_dnf/2` - evaluates DNF against active conditions
     - `evaluate_conjunction/2` - evaluates single conjunction
     - `satisfied_disjuncts/2` - finds which disjuncts are satisfied
   - Full test coverage in `test/electric/shapes/where_clause_test.exs`

4. **Phase 8: Consumer Updates** ✅
   - Updated invalidation logic in `consumer.ex` to not invalidate when valid DNF exists
   - Updated `subquery_moves.ex` for DNF-aware move-out patterns

5. **Phase 9: Move Handling** ✅
   - Implemented NOT inversion in `move_handling.ex`:
     - Move-in to negated position triggers move-out
     - Move-out from negated position triggers move-in query
   - Added position-to-dependency mapping support

6. **Deduplication for OR Shapes** ✅
   - Added exclusion clauses in `subquery_moves.ex`:
     - Move-in queries now include `AND NOT (column IN other_subquery)` for each other disjunct
     - Prevents duplicate inserts when row already in shape via another subquery
   - Note: Deduplication only works for OR with other subqueries, not simple column conditions
     (client handles deduplication for those cases using tags)

7. **Integration Tests** ✅
   - Created `test/electric/plug/subquery_router_test.exs`
   - Tests for OR with subqueries, NOT with subqueries, and edge cases
   - Updated `test/electric/plug/router_test.exs`:
     - Tests no longer expect 409 for OR/NOT shapes
     - Tests verify proper move-in/move-out behavior

### Current Test Status

- All 1389 tests pass
- All 21 subquery router tests pass
- All decomposer tests pass
- All WhereClause tests pass

### Remaining Work (Lower Priority)

1. **Protocol and Message Format** (Lower priority)
   - Add active_conditions to log items
   - Update client protocol for DNF-aware tags
   - Protocol version validation for complex shapes

2. **removed_tags for Updates** (Lower priority)
   - Track tags from old record that no longer apply on updates

### Key Commits

1. `1ac38ab08` - Add integration tests for arbitrary boolean expressions
2. `ca4e72864` - Add DNF decomposer for arbitrary boolean expressions
3. `700cc642e` - Add DNF decomposition to Shape module
4. `25ccd18db` - Add active conditions computation to WhereClause
5. `e07208434` - Update invalidation logic and tag structure for DNF
6. `afecd0f58` - Add fallback clause for extract_tag_column edge cases
7. `e657649e6` - Add implementation progress update to plan
8. `b57ef1a0a` - Add OR deduplication and fix tests for DNF semantics
