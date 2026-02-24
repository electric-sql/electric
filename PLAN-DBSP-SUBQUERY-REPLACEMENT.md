# Plan: Replace Subquery Processing with DBSP

## Executive Summary

Electric currently handles subqueries in shape WHERE clauses through a
multi-process materialization pipeline. A "parent" shape with a subquery like
`WHERE parent_id IN (SELECT id FROM items WHERE val > 5)` spawns a
"dependency" shape for the inner query, a `Materializer` that tracks the
dependency's live result set, and a `MoveHandling` system that queries
Postgres for rows that "move in" or "move out" when the dependency changes.

This works but has significant limitations:

1. Only one subquery per shape (multiple subqueries cause invalidation)
2. `NOT IN` causes invalidation (move-in to subquery = move-out from outer)
3. `OR` combined with subqueries causes invalidation
4. No support for correlated subqueries
5. The entire pipeline is ad-hoc; each new SQL feature requires custom code
6. Move-in queries hit Postgres, adding latency and load
7. Nested subqueries (3+ levels) are unsupported

DBSP (Database Stream Processing) provides a principled replacement. By
modeling the full query as a DBSP circuit operating on Z-set streams, we get
a general-purpose incremental view maintenance algorithm that handles
arbitrary compositions of relational operators — including all the cases
above — through a single, uniform mechanism.

This plan describes how to incrementally migrate from the current
approach to DBSP, leveraging the existing `d2ts` (differential dataflow in
TypeScript) library that TanStack DB already uses for live queries.

---

## 1. Current Architecture (What We're Replacing)

### 1.1 Shape Dependency Lifecycle

When a shape is created with a subquery in its WHERE clause
(`packages/sync-service/lib/electric/shapes/shape.ex`):

1. **Parsing**: `Parser.extract_subqueries/1` pulls inner SELECT statements
   from the WHERE clause AST.

2. **Dependency creation**: `build_shape_dependencies/2` creates child
   `Shape` structs for each subquery (recursively calling `Shape.new/1`).

3. **Tag structure**: `SubqueryMoves.move_in_tag_structure/1` walks the
   expression tree to find `sublink_membership_check` nodes and extracts
   column references used to build "move tags" — hash-based identifiers
   that track *why* a row belongs to the shape.

4. **Materializer**: Each dependency shape gets a `Materializer` GenServer
   (`consumer/materializer.ex`) that maintains an in-memory index of the
   dependency's current result set. The parent consumer subscribes to
   materializer change notifications.

5. **Move handling**: When the materializer detects changes (move-in/move-out),
   the parent consumer's `MoveHandling` module:
   - For move-ins: fires an async Postgres query via `PartialModes.query_move_in_async`
     to fetch rows that now match, splicing results into the log
   - For move-outs: emits control messages with tag patterns so clients can
     remove rows that no longer belong

### 1.2 Change Processing Pipeline

For each WAL transaction (`consumer.ex:do_handle_txn`):

1. Materializer refs are fetched (`get_all_as_refs`) — the current result
   sets of all dependency shapes.
2. Two ref snapshots are computed: "before move-ins" and "after move-ins" to
   handle in-flight queries correctly.
3. `ChangeHandling.process_changes/3` iterates each change:
   - For shapes without dependencies: simple `Shape.convert_change` filter
   - For shapes with dependencies: additional checks against pending move-ins
     to avoid duplicate rows
4. `Shape.convert_change` evaluates the WHERE clause against the row, using
   `extra_refs` (the materialized subquery results) for sublink membership checks.

### 1.3 Limitations of Current Approach

| Limitation | Root Cause |
|---|---|
| Single subquery only | `MoveHandling` assumes one dependency; multiple cause invalidation (`consumer.ex:297`) |
| No `NOT IN` | Move-in to subquery should trigger move-out from parent — not implemented |
| No `OR` with subquery | Can't determine which disjunct caused the match |
| No correlated subqueries | Subqueries are independent shapes with no reference to outer row |
| Move-in latency | Each move-in fires a Postgres roundtrip |
| 3+ level nesting | `tagged_subqueries` feature flag gates it; invalidation is the fallback |

---

## 2. DBSP Theory: What We Need

### 2.1 Core Concepts

DBSP models computations as circuits over streams of values from abelian
groups (values with +, -, and 0). The key insight: database tables can be
represented as **Z-sets** — maps from rows to integer weights (1 = present,
-1 = deleted, 0 = absent). Changes (deltas) to a table are also Z-sets.

Four operators form the entire basis:

| Operator | Notation | Meaning |
|---|---|---|
| **Lift** | `↑f` | Apply scalar function `f` to each stream element independently |
| **Delay** | `z⁻¹` | Output the previous stream element (with 0 at t=0) |
| **Differentiation** | `D` | `D(s)[t] = s[t] - s[t-1]` — compute the change stream |
| **Integration** | `I` | `I(s)[t] = Σ_{i≤t} s[i]` — accumulate changes into state |

### 2.2 The Incrementalization Algorithm (Algorithm 4.6)

Given any query Q:

1. Translate Q into a DBSP circuit using Z-set operators
2. Eliminate redundant `distinct` operators
3. Lift the circuit to operate on streams: `↑Q`
4. Wrap in I and D: `Q^Δ = D ∘ ↑Q ∘ I`
5. Apply the **chain rule** recursively: `(Q1 ∘ Q2)^Δ = Q1^Δ ∘ Q2^Δ`

Key efficiency results:
- **Linear operators** (filter, project, union): `Q^Δ = Q` — just apply to deltas directly
- **Bilinear operators** (join): `(a ⊲⊳ b)^Δ = Δa ⊲⊳ Δb + a ⊲⊳ Δb + Δa ⊲⊳ b` — incremental join
- **distinct**: Efficiently incrementalizable via the H function (Proposition 4.7)

### 2.3 Why This Solves Our Problems

| Current Limitation | DBSP Solution |
|---|---|
| Single subquery | Chain rule composes arbitrarily — multiple subqueries are just composed operators |
| `NOT IN` | Anti-join is expressible as `distinct(a - (a ⊲⊳ b))` — incrementalizes naturally |
| `OR` with subquery | Union + distinct: `distinct(Q_left + Q_right)` |
| Correlated subqueries | Flatmap/dependent join — expressible in DBSP via nested relations |
| Move-in latency | No Postgres roundtrip — incremental result computed from deltas |
| Nested subqueries | Chain rule handles arbitrary depth |

---

## 3. Architecture: Where DBSP Runs

### 3.1 Key Design Decision: Server-Side DBSP

DBSP processing will run **server-side in the Electric sync service** (Elixir),
not client-side. Rationale:

- The sync service already receives the full WAL change stream
- The sync service already maintains per-shape state (Consumer, Storage)
- DBSP needs access to the full base tables (via integration operators) —
  the client only has partial data
- Client-side d2ts handles live queries *within* synced data; DBSP handles
  the *determination of what to sync*

### 3.2 Relationship to d2ts and TanStack DB

The architecture creates a clean separation:

```
┌─────────────────────────────────────┐
│          Electric Sync Service      │
│                                     │
│  WAL Stream ──► DBSP Circuit        │
│                  │                  │
│                  ▼                  │
│  Per-shape incremental output       │
│  (Z-set deltas = change stream)     │
│                  │                  │
│                  ▼                  │
│  Shape Log (storage)                │
└──────────────┬──────────────────────┘
               │ HTTP Shape Stream
               ▼
┌─────────────────────────────────────┐
│          TanStack DB (Client)       │
│                                     │
│  Electric Collection                │
│       │                             │
│       ▼                             │
│  d2ts live queries                  │
│  (client-side joins, filters, etc.) │
└─────────────────────────────────────┘
```

- **Electric DBSP**: determines *which rows belong to a shape* incrementally,
  handling subqueries, joins, and complex WHERE clauses. Produces a change
  stream for each shape.
- **d2ts**: provides *client-side reactivity* over the synced data —
  re-filtering, joining collections, aggregating for UI display.

### 3.3 Subset Requests as the Bridge

The existing `requestSnapshot`/`fetchSnapshot` mechanism
(`packages/typescript-client/src/client.ts`) allows clients to fetch subsets
of data on-demand. With DBSP:

- The client doesn't need to know about subqueries at all
- The server computes the correct shape contents incrementally
- If a client needs additional data beyond the shape (e.g., for a UI join),
  it uses `requestSnapshot` with the existing subset API — this remains
  unchanged

---

## 4. Implementation Plan

### Phase 0: Foundation — Z-set Library for Elixir

**Goal**: Build the core data structures and operators needed for DBSP circuits.

#### 4.0.1 Z-set Data Structure

Create `Electric.DBSP.ZSet` — a map from terms to integer weights with group
operations:

```elixir
defmodule Electric.DBSP.ZSet do
  @type t(k) :: %{optional(k) => integer()}

  def new(), do: %{}
  def singleton(key, weight \\ 1), do: %{key => weight}

  # Group operations
  def add(a, b)        # pointwise addition
  def negate(a)        # pointwise negation
  def subtract(a, b)   # add(a, negate(b))

  # Relational operations on Z-sets
  def filter(zset, pred)
  def project(zset, proj_fn)
  def join(a, b, key_a, key_b, combine)
  def distinct(zset)   # all positive weights → 1, rest → 0
  def union(a, b)      # distinct(add(a, b))
  def difference(a, b) # distinct(subtract(a, b))
end
```

Represent rows as maps (matching Electric's existing `record` format).
Weights are integers (typically +1 for insert, -1 for delete).

#### 4.0.2 Stream Operators

Create `Electric.DBSP.Stream` — stateful operators that process one delta at
a time:

```elixir
defmodule Electric.DBSP.Operators do
  # Lift: apply a Z-set function to a delta (stateless)
  def lift(f), do: f

  # Integration: accumulate deltas into running state
  defmodule Integrate do
    defstruct state: %{}
    def step(%Integrate{state: s} = op, delta) do
      new_state = ZSet.add(s, delta)
      {delta, %{op | state: new_state}}  # returns (output, new_op_state)
    end
    def current(%Integrate{state: s}), do: s
  end

  # Differentiation: compute change from previous
  defmodule Differentiate do
    defstruct prev: %{}
    def step(%Differentiate{prev: p} = op, input) do
      delta = ZSet.subtract(input, p)
      {delta, %{op | prev: input}}
    end
  end

  # Delay: output previous input
  defmodule Delay do
    defstruct prev: %{}
    def step(%Delay{prev: p} = op, input) do
      {p, %{op | prev: input}}
    end
  end

  # Incremental distinct (Proposition 4.7)
  defmodule IncrementalDistinct do
    defstruct integrated: %{}
    def step(%IncrementalDistinct{integrated: i} = op, delta) do
      new_integrated = ZSet.add(i, delta)
      output = h_function(i, delta)
      {output, %{op | integrated: new_integrated}}
    end
  end

  # Incremental join (Theorem 3.4)
  defmodule IncrementalJoin do
    defstruct left_state: %{}, right_state: %{}
    def step(op, delta_left, delta_right) do
      # Δa ⊲⊳ Δb + prev_a ⊲⊳ Δb + Δa ⊲⊳ prev_b
      result = ZSet.add(
        ZSet.add(
          ZSet.join(delta_left, delta_right, ...),
          ZSet.join(op.left_state, delta_right, ...)
        ),
        ZSet.join(delta_left, op.right_state, ...)
      )
      new_op = %{op |
        left_state: ZSet.add(op.left_state, delta_left),
        right_state: ZSet.add(op.right_state, delta_right)
      }
      {result, new_op}
    end
  end
end
```

#### 4.0.3 Circuit Builder

Create `Electric.DBSP.Circuit` — a DSL for composing operators into circuits:

```elixir
defmodule Electric.DBSP.Circuit do
  defstruct nodes: %{}, edges: [], state: %{}

  def new() :: t()
  def add_node(circuit, id, operator) :: t()
  def add_edge(circuit, from, to) :: t()
  def step(circuit, inputs) :: {outputs, updated_circuit}
end
```

**Files to create:**
- `lib/electric/dbsp/z_set.ex`
- `lib/electric/dbsp/operators.ex`
- `lib/electric/dbsp/circuit.ex`
- `test/electric/dbsp/z_set_test.exs`
- `test/electric/dbsp/operators_test.exs`
- `test/electric/dbsp/circuit_test.exs`

**Estimated scope**: ~800-1200 lines of Elixir + tests.

---

### Phase 1: SQL-to-DBSP Compiler

**Goal**: Translate shape WHERE clauses (with subqueries) into DBSP circuits.

#### 4.1.1 Query Plan Extraction

Extend the existing `Parser.extract_subqueries/1` to produce a structured
query plan rather than a flat list of subquery strings. The plan should
capture:

```elixir
%QueryPlan{
  # Root filter on the main table
  root_filter: %Filter{predicate: ...},
  # Subquery references with their operators (IN, NOT IN, EXISTS, etc.)
  subquery_ops: [
    %SubqueryOp{
      type: :in,          # or :not_in, :exists, :not_exists, :scalar_compare
      outer_refs: [...],  # columns from outer table used in comparison
      inner_query: %{
        table: {"public", "items"},
        filter: ...,
        projection: [...],
        # Nested subqueries would recurse here
      }
    }
  ],
  # How subquery results combine with the root filter
  combination: :and  # or :or, :not, etc.
}
```

#### 4.1.2 Plan-to-Circuit Translation

Implement Algorithm 4.6 from the DBSP paper:

```elixir
defmodule Electric.DBSP.Compiler do
  @doc """
  Given a query plan, produce a DBSP circuit that:
  - Takes delta streams for each referenced table as input
  - Produces a delta stream of matching rows as output
  """
  def compile(%QueryPlan{} = plan) :: Circuit.t()

  # Translation rules (Table 1 from paper):
  # - Filter σ_P → lifted filter (linear, so Δ-version = itself)
  # - Projection π → lifted projection (linear)
  # - IN subquery → semi-join ⊲⊳ (bilinear → incremental join formula)
  # - NOT IN → anti-join: distinct(a - a⊲⊳b)
  # - EXISTS → semi-join with existence check
  # - OR → union + distinct
  # - AND → composed filters or intersection
end
```

The key translations for subquery patterns:

| SQL Pattern | DBSP Circuit |
|---|---|
| `col IN (SELECT ...)` | `semi_join(outer, inner, col)` → bilinear, incrementalizes via Theorem 3.4 |
| `col NOT IN (SELECT ...)` | `distinct(outer - semi_join(outer, inner, col))` |
| `EXISTS (SELECT ... WHERE outer.id = inner.fk)` | `semi_join(outer, inner, id=fk)` |
| `NOT EXISTS (...)` | `distinct(outer - semi_join(outer, inner, ...))` |
| `col = (SELECT scalar ...)` | `join(outer, inner, col=result)` with aggregation |
| `cond1 OR col IN (...)` | `distinct(filter(outer, cond1) + semi_join(outer, inner, col))` |
| `cond1 AND col IN (...)` | `filter(semi_join(outer, inner, col), cond1)` |

**Files to create/modify:**
- `lib/electric/dbsp/compiler.ex`
- `lib/electric/dbsp/query_plan.ex`
- Modify `lib/electric/replication/eval/parser.ex` to produce structured plans
- `test/electric/dbsp/compiler_test.exs`

**Estimated scope**: ~600-1000 lines + tests.

---

### Phase 2: Integrate DBSP into the Consumer Pipeline

**Goal**: Replace the Materializer + MoveHandling pipeline with DBSP circuit
evaluation.

#### 4.2.1 DBSP-Aware Consumer State

Add a compiled DBSP circuit to the Consumer state, replacing the separate
materializer/move-handling machinery:

```elixir
defmodule Electric.Shapes.Consumer.State do
  # New field:
  field :dbsp_circuit, Electric.DBSP.Circuit.t()

  # Replaces:
  # - shape_dependencies / shape_dependencies_handles
  # - move_handling_state
  # - or_with_subquery? / not_with_subquery?
  # - subquery_comparison_expressions
end
```

#### 4.2.2 Transaction Processing with DBSP

Replace the current `ChangeHandling.process_changes/3` flow:

```
Current:
  WAL txn
    → filter changes by root table
    → evaluate WHERE clause with extra_refs from materializers
    → handle move-ins via Postgres queries
    → handle move-outs via control messages

New (DBSP):
  WAL txn
    → extract deltas per table (root + all subquery tables)
    → feed deltas into DBSP circuit
    → circuit produces output delta (Z-set of row changes)
    → convert output delta to shape log entries
```

The critical advantage: **no Postgres roundtrips for move-ins**. The DBSP
circuit maintains integrated state for all referenced tables, so when a
subquery's result set changes, the incremental join formula directly computes
which outer rows are affected.

#### 4.2.3 Multi-Table WAL Routing

Currently, each Consumer only receives changes for its `root_table` (via
the `ShapeLogCollector` dispatcher). With DBSP, a shape's circuit may
reference multiple tables.

Options:
1. **Expand the dispatcher**: Register each shape for all tables in its
   circuit. The dispatcher already supports multi-table routing.
2. **Shared table streams**: Create a broadcast mechanism where table
   deltas are shared across consumers that reference the same table.

Option 1 is simpler and sufficient initially. The dispatcher
(`Electric.Shapes.Dispatcher`) routes by relation; we just need shapes to
register for their subquery tables too.

**Approach**: Modify `Shape.list_relations/1` to return all tables
referenced by the shape (including subquery tables). The dispatcher already
uses this to determine routing.

#### 4.2.4 State Management: Integration Operators

DBSP's integration operators (`I`) accumulate the full state of each
intermediate relation. For a shape like:

```sql
WHERE parent_id IN (SELECT id FROM parents WHERE active = true)
```

The circuit needs to maintain:
- The accumulated `parents` table (filtered by `active = true`)
- The accumulated join result

This replaces the Materializer's `value_counts` and `index` maps with
the circuit's own integrated state. The memory footprint is similar (both
must track the full result sets), but the DBSP version is general-purpose.

**Persistence consideration**: Circuit state must survive Consumer restarts.
Options:
- **Cold start**: On restart, replay from the shape's snapshot. The circuit
  reprocesses all accumulated deltas (same as current behavior for
  materializers, which rebuild from the log).
- **State checkpointing**: Periodically serialize circuit state. This is an
  optimization for later; cold start is correct and sufficient.

#### 4.2.5 Initial Snapshot with DBSP

The initial snapshot query (`Querying.stream_initial_data`) currently uses
the WHERE clause with subqueries expanded inline. With DBSP, the initial
snapshot serves a dual purpose:

1. Provide the initial data to the client (unchanged)
2. Bootstrap the DBSP circuit's integration state

The snapshot query can remain as-is (Postgres evaluates the full query
including subqueries). After the snapshot, the circuit's integration state
is initialized to match the snapshot result, and subsequent WAL deltas are
processed incrementally.

**Files to create/modify:**
- Modify `lib/electric/shapes/consumer.ex`
- Modify `lib/electric/shapes/consumer/state.ex`
- Replace `lib/electric/shapes/consumer/move_handling.ex` (eventually remove)
- Replace `lib/electric/shapes/consumer/change_handling.ex`
- Modify `lib/electric/shapes/shape.ex` (`list_relations/1`)
- Modify `lib/electric/replication/shape_log_collector.ex` (multi-table)
- `test/electric/shapes/consumer_dbsp_test.exs`

**Estimated scope**: ~1000-1500 lines of changes + tests.

---

### Phase 3: Remove Move-In/Move-Out Machinery

**Goal**: Once DBSP handles all subquery cases, remove the old pipeline.

#### 4.3.1 Remove Components

- `lib/electric/shapes/consumer/materializer.ex` — No longer needed; DBSP
  circuit tracks subquery state internally
- `lib/electric/shapes/consumer/move_handling.ex` — Replaced by circuit output
- `lib/electric/shapes/consumer/move_ins.ex` — Replaced by circuit state
- `lib/electric/shapes/shape/subquery_moves.ex` — Tag structure generation
  moves into DBSP output formatting

#### 4.3.2 Simplify Consumer

- Remove `materializer_subscribed?`, `or_with_subquery?`,
  `not_with_subquery?` flags
- Remove `move_handling_state` from Consumer.State
- Remove `shape_dependencies_handles` (shapes still track dependencies for
  cleanup, but don't need handle-based materializer subscriptions)
- Remove the `should_invalidate?` check — DBSP handles all cases

#### 4.3.3 Simplify Move Tags

Move tags (the hash-based tracking of *why* a row is in a shape) currently
exist to support client-side move-out. With DBSP:

- The circuit directly produces delete deltas when rows leave the shape
- These become `DeletedRecord` entries in the shape log
- Move tags can be simplified or removed entirely

However, move tags also serve a purpose for the *client* to reconcile
optimistic state. This needs careful analysis — if the client's Electric
collection uses tags for anything beyond move-in/move-out tracking, we may
need to preserve them in a simplified form.

**Estimated scope**: ~500 lines removed, ~200 lines modified.

---

### Phase 4: Advanced Features Enabled by DBSP

Once the foundation is in place, DBSP unlocks capabilities that were
impractical with the old approach:

#### 4.4.1 Multiple Subqueries

```sql
WHERE parent_id IN (SELECT ...) AND category_id IN (SELECT ...)
```

The circuit simply has two join operators composed with a filter. No
special-casing needed.

#### 4.4.2 NOT IN / NOT EXISTS

```sql
WHERE id NOT IN (SELECT blocked_id FROM blocks WHERE ...)
```

Anti-join: `distinct(outer - semi_join(outer, inner, ...))`. The incremental
version correctly produces +1 weights when a row *leaves* the block list
(meaning the outer row should now appear).

#### 4.4.3 OR with Subqueries

```sql
WHERE is_featured = true OR category_id IN (SELECT ...)
```

`distinct(filter(outer, is_featured) + semi_join(outer, inner, category_id))`.
Distinct ensures no duplicates when a row matches both conditions.

#### 4.4.4 Correlated Subqueries (Future)

```sql
WHERE price > (SELECT avg(price) FROM items WHERE items.category = outer.category)
```

Requires dependent join / flatmap — expressible in DBSP but more complex.
Likely a follow-up phase.

#### 4.4.5 Recursive Queries (Future)

DBSP's theory supports recursive fixpoints (§5-6 of the paper). This could
eventually support recursive CTE shapes, graph reachability queries, etc.

---

## 5. Migration Strategy

### 5.1 Feature Flag Gating

Introduce a feature flag `dbsp_subquery_processing` (alongside the existing
`allow_subqueries` and `tagged_subqueries` flags):

```elixir
# In consumer.ex
if "dbsp_subquery_processing" in feature_flags do
  # Use DBSP circuit for change processing
  DBSP.Consumer.process_transaction(circuit, txn)
else
  # Use existing materializer + move handling
  ChangeHandling.process_changes(changes, state, ctx)
end
```

### 5.2 Incremental Rollout

1. **Phase 0**: Ship Z-set library and operators with comprehensive tests.
   No user-visible changes.

2. **Phase 1**: Ship compiler behind feature flag. Run both old and new
   pipelines in shadow mode, comparing outputs.

3. **Phase 2**: Enable DBSP for shapes with subqueries that currently cause
   invalidation (NOT IN, OR, multiple subqueries). These shapes currently
   *don't work* incrementally, so DBSP is a pure improvement.

4. **Phase 3**: Enable DBSP for all shapes with subqueries. Compare
   performance and correctness with existing pipeline.

5. **Phase 4**: Remove old pipeline once DBSP is proven.

### 5.3 Correctness Validation

- **Property-based testing**: Generate random Z-sets and operations, verify
  incremental results match full recomputation.
- **Shadow mode**: Run both pipelines in parallel during integration tests,
  assert identical output.
- **Existing test suite**: The current tests in
  `test/integration/subquery_*_test.exs` and `test/electric/shapes/consumer_test.exs`
  must pass with DBSP enabled.

---

## 6. Performance Considerations

### 6.1 Memory

DBSP integration operators maintain the full accumulated state of each
intermediate relation. For a shape with one subquery, this is:
- The full filtered subquery result set (same as current Materializer)
- The full join result (new — but bounded by the shape's output size)

Total memory is O(|shape_output| + |subquery_results|), similar to current.

### 6.2 CPU per Transaction

For each WAL transaction:
- **Linear operators** (filter, project): O(|delta|) — same as current
- **Incremental join**: O(|delta| × max(|left_state|, |right_state|)) —
  same asymptotic cost as current move-in queries, but without network
  roundtrip to Postgres
- **Incremental distinct**: O(|delta|)

The key performance win: **no Postgres roundtrips for move-ins**. Currently,
each subquery change triggers `PartialModes.query_move_in_async` which opens
a DB connection, runs a query, and streams results back. With DBSP, the
circuit computes the answer locally in memory.

### 6.3 Latency

Current pipeline: subquery change → materializer notification → async
Postgres query → result splice → client notification. This involves at
least one Postgres roundtrip (~1-10ms typically).

DBSP pipeline: WAL delta → circuit step → output delta → client
notification. Pure in-memory computation (~microseconds for typical deltas).

---

## 7. Open Questions

1. **Circuit state serialization**: For Consumer restart, should we serialize
   circuit state or replay from snapshot? Replay is simpler but slower for
   large shapes. Start with replay; add serialization if restart performance
   is a problem.

2. **Shared integration state**: If multiple shapes reference the same
   subquery table, should their circuits share integration state? This is an
   optimization — start with independent circuits per shape.

3. **Move tag compatibility**: Clients currently use move tags to reconcile
   move-in/move-out events. With DBSP producing direct insert/delete deltas,
   we need to verify the client protocol handles this correctly. The
   `changes_only` mode with `requestSnapshot` may need adjustment.

4. **Memory pressure**: For shapes with large subquery result sets, the
   circuit's integration state could be significant. Consider spill-to-disk
   for integration operators, similar to how the existing Materializer could
   theoretically be backed by storage.

5. **Transaction ordering**: DBSP assumes a total order on transactions
   (which Postgres provides via LSN). Verify that the existing WAL streaming
   guarantees are sufficient for DBSP's causal correctness requirements.

6. **Partial recomputation on schema change**: If a referenced table's
   schema changes, the circuit must be invalidated and rebuilt. This matches
   current behavior (shape invalidation on relation change).

---

## 8. File Inventory

### New Files
| File | Purpose |
|---|---|
| `lib/electric/dbsp/z_set.ex` | Z-set data structure with group operations |
| `lib/electric/dbsp/operators.ex` | Stream operators (I, D, z⁻¹, incremental join/distinct) |
| `lib/electric/dbsp/circuit.ex` | Circuit builder and evaluator |
| `lib/electric/dbsp/compiler.ex` | SQL query plan → DBSP circuit translation |
| `lib/electric/dbsp/query_plan.ex` | Structured query plan representation |
| `test/electric/dbsp/*_test.exs` | Tests for all DBSP modules |

### Modified Files
| File | Change |
|---|---|
| `lib/electric/shapes/consumer.ex` | Add DBSP circuit to state; new change processing path |
| `lib/electric/shapes/consumer/state.ex` | Add `dbsp_circuit` field |
| `lib/electric/shapes/consumer/change_handling.ex` | DBSP-based change processing |
| `lib/electric/shapes/shape.ex` | Expand `list_relations/1` for multi-table routing |
| `lib/electric/replication/eval/parser.ex` | Produce structured query plans |
| `lib/electric/shapes/dispatcher.ex` | Route WAL changes to shapes by all referenced tables |

### Eventually Removed Files
| File | When |
|---|---|
| `lib/electric/shapes/consumer/materializer.ex` | Phase 3 |
| `lib/electric/shapes/consumer/move_handling.ex` | Phase 3 |
| `lib/electric/shapes/consumer/move_ins.ex` | Phase 3 |
| `lib/electric/shapes/shape/subquery_moves.ex` | Phase 3 (partially — tag logic may be retained) |

---

## 9. Summary

Replacing subquery processing with DBSP transforms Electric's incremental
view maintenance from a collection of ad-hoc mechanisms into a principled,
composable system grounded in mathematical theory. The migration is
incremental (feature-flagged, shadow-tested) and the end state is strictly
more capable: supporting multiple subqueries, NOT IN, OR combinations,
and eventually correlated subqueries and recursive queries — all without
Postgres roundtrips for incremental updates.
