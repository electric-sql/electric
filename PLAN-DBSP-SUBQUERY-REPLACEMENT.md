# Plan: Replace Subquery Processing with DBSP (v3)

> **v3**: Revised after second review. v2 established the data availability gap
> and three architecture options (A: row store, B: membership + hydration,
> C: client-driven). v3 addresses three make-or-break gaps identified in
> review: (1) arrangement bootstrap and WAL catch-up — how shared table state
> gets a consistent starting point; (2) pending hydration buffering — the
> update-before-insert race during async hydration; (3) transaction boundary
> contract — when shared arrangements update relative to shape evaluation.
> Also adds Option B.0 (smallest first step reusing existing materializers),
> intersection/difference operators, move-out bandwidth analysis, and
> corrected shadow-mode oracle strategy.

---

## Table of Contents

1. [Why DBSP — What It Actually Fixes](#1-why-dbsp--what-it-actually-fixes)
2. [Current Architecture (What We're Replacing)](#2-current-architecture-what-were-replacing)
3. [The Data Availability Gap](#3-the-data-availability-gap)
4. [Architecture Options](#4-architecture-options)
5. [DBSP Theory — Minimal Subset We Need](#5-dbsp-theory--minimal-subset-we-need)
6. [Correctness Details: NULL Semantics and NOT IN](#6-correctness-details-null-semantics-and-not-in)
7. [Performance: Arrangements, Not Naive Maps](#7-performance-arrangements-not-naive-maps)
8. [Shared State Across Shapes](#8-shared-state-across-shapes)
9. [Implementation Plan (Pragmatic Path)](#9-implementation-plan-pragmatic-path)
10. [Migration Strategy](#10-migration-strategy)
11. [Open Questions and Decision Hinges](#11-open-questions-and-decision-hinges)
12. [File Inventory](#12-file-inventory)

---

## 1. Why DBSP — What It Actually Fixes

The DNF/tag + async move-in-query plan is getting painful. DBSP is being
considered as a replacement. Before diving into how, it's worth being precise
about *which* problems DBSP solves and which it doesn't.

### 1.1 Problems DBSP Genuinely Solves

**Eliminates DNF expansion entirely.** The current plan leans on DNF to make
client logic simple, but DNF is inherently exponential. We added a
`max_disjuncts` guard for a reason. DBSP compiles the boolean expression as
a circuit that mirrors the AST. Complexity stays proportional to the
expression tree size, not the DNF size.

**Removes the root cause of the hardest orchestration.** The current
pipeline invents a mini-consistency model to handle async move-in queries:
REPEATABLE READ snapshots, `pg_current_snapshot`, `touch_tracker` races,
`moved_out_tags` filtering (now position-aware), exclusion clauses to avoid
duplicate inserts, "eventual consistency / up-to-date markers may precede
move-ins", client-side synthetic deletes. All of that exists because the
system doesn't know the answer at the time of the WAL transaction — it has
to ask Postgres later. A DBSP-style engine computes the membership delta
synchronously, so most of that complexity vanishes.

**Eliminates protocol v2 / client tag+active_conditions complexity.** The
old plan required new wire format tags (multi-disjunct), `active_conditions`,
position-indexed client state, synthetic deletes, and protocol negotiation.
DBSP lets us go back to the simpler client contract: **clients receive
inserts/updates/deletes that already reflect shape membership.** That's a
huge product and engineering win — fewer clients to update, fewer subtle
bugs.

**Handles OR/NOT/multiple subqueries uniformly.** Instead of special-casing
each combination with custom code, all compositions are just composed
operators in the circuit.

### 1.2 What DBSP Does NOT Automatically Solve

**The data availability gap.** DBSP computes *which rows should be in the
result*. It does not conjure row bodies out of thin air. When a subquery
result changes, DBSP can determine that certain outer rows are now eligible,
but if the sync service doesn't have those row bodies, it can't emit them.
This is the central architectural question. See [§3](#3-the-data-availability-gap).

---

## 2. Current Architecture (What We're Replacing)

### 2.1 Shape Dependency Lifecycle

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
   - For move-ins: fires an async Postgres query via
     `PartialModes.query_move_in_async` to fetch rows that now match,
     splicing results into the log
   - For move-outs: emits control messages with tag patterns so clients can
     remove rows that no longer belong

### 2.2 Change Processing Pipeline

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
   `extra_refs` (the materialized subquery results) for sublink membership
   checks.

### 2.3 WAL Dispatch Architecture

Changes flow: PostgreSQL WAL → ReplicationClient → ShapeLogCollector →
EventRouter/Filter → ConsumerRegistry → Consumer processes.

Key details relevant to DBSP:
- **Filter** (`filter.ex`) maps changes to affected shapes using ETS-backed
  indexes (EqualityIndex, InclusionIndex) for O(1) matching by table.
- **DependencyLayers** ensures shapes are processed in topological order
  (dependencies before dependents — inner/subquery shapes evaluate before
  the outer shapes that reference them).
- **ConsumerRegistry** dispatches synchronously within each layer.
- Currently each consumer is registered for its `root_table` only. Subquery
  tables are handled indirectly via dependency shapes + materializers.

### 2.4 Limitations of Current Approach

| Limitation | Root Cause | Impact |
|---|---|---|
| Single subquery only | `MoveHandling` assumes one dependency; multiple cause invalidation (`consumer.ex:297`) | Shape gets cleaned and rebuilt from scratch |
| No `NOT IN` | Move-in to subquery should trigger move-out from parent — not implemented | `should_invalidate?` = true |
| No `OR` with subquery | Can't determine which disjunct caused the match | `should_invalidate?` = true |
| No correlated subqueries | Subqueries are independent shapes with no reference to outer row | Not supported at all |
| Move-in latency | Each move-in fires a Postgres roundtrip (~1-10ms) | Eventual consistency for subquery shapes |
| 3+ level nesting | `tagged_subqueries` feature flag gates it | Invalidation is the fallback |
| Move-in race conditions | Async queries create snapshot positioning, touch_tracker, moved_out_tags complexity | Hard-to-debug correctness issues |

---

## 3. The Data Availability Gap

This is the single most important section. It was missing from v1 of this
plan.

### 3.1 The Problem

Consider:

```sql
SELECT * FROM tasks
WHERE project_id IN (SELECT id FROM projects WHERE active = true)
```

At shape creation time, Electric snapshots only the matching tasks (those
whose `project_id` points to an active project). Later, a project flips
`active = false → true`. The WAL delta contains a change to `projects`. No
`tasks` rows changed, so the WAL gives us no task row bodies. But
correctness requires delivering all tasks for that now-active project.

**DBSP can compute the delta of the query result only if the circuit has
state for the outer relation it needs to join against.** If the circuit's
"integrated" state for `tasks` does not contain those rows, the output delta
cannot include them — because there's nothing to join with.

### 3.2 Why This Is Fundamental

The claim "no Postgres roundtrips" is only true if the sync service already
maintains the relevant portion of the outer table in its own state store.

In today's system, the Materializer tracks the *inner* (subquery) result
set, and Postgres is the "oracle" for the *outer* rows. DBSP doesn't change
the need for outer row data — it just changes where you look for it.

### 3.3 The Real Tradeoff: DBSP Shifts Cost from Postgres to Electric

| | DNF/tag plan (current) | DBSP plan |
|---|---|---|
| **Postgres role** | Index + storage of excluded outer rows | Only WAL source |
| **Electric stores** | Dependency subquery result sets (materializers) + shape output rows | Candidate outer rows + subquery sets + indexes/arrangements |
| **Complexity** | Orchestration + client protocol | Incremental query engine + state store |
| **Postgres load** | Move-in queries per subquery change | None (if Option A) or PK lookups (if Option B) |
| **Electric memory** | Lower | Higher |

---

## 4. Architecture Options

All options use DBSP-style incremental computation for determining
*membership* (which PKs belong in the shape). They differ in how they
resolve the data availability gap — where row bodies come from.

### 4.1 Option A: Server-Side Candidate Row Store (True No-Query DBSP)

**Concept**: Electric maintains a local store (memory + optional disk) of
"candidate" outer rows — rows that *could* become shape members if subquery
conditions change. Updated continuously from WAL.

**How it works**:

```
Shape: SELECT * FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE active)
```

Split the query into:
- `tasks_candidate = σ(outer-only predicates)(tasks)` — tasks filtered by
  predicates that don't involve subqueries. **Note**: outer-only predicates
  are shape-specific (shape A might filter `WHERE priority > 3 AND ...`
  while shape B filters `WHERE category = 'ops' AND ...`). Per-table
  amortization requires either storing the whole table (no outer filter)
  or maintaining a shared superset. The pragmatic first step: store the
  whole table's PKs + join columns, apply outer-only filters per shape.
- `result = tasks_candidate ⋉ active_projects` — semi-join with subquery

Maintain `tasks_candidate` locally. When `active_projects` changes, the
incremental semi-join probes the candidate store to find newly-eligible or
newly-excluded rows.

**Architecture**:

```
┌─────────────────────────────────────────────────────────┐
│                Electric Sync Service                     │
│                                                          │
│  WAL ──► Per-Table Row Store + Arrangements              │
│              │ (candidate rows indexed by join keys)      │
│              │                                            │
│              ▼                                            │
│  WAL ──► DBSP Membership Engine                          │
│              │ (incremental semi/anti-join)                │
│              │                                            │
│              ▼                                            │
│  Membership Δ + Row Store lookup ──► Shape Log            │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP Shape Stream
                           ▼
                    TanStack DB (Client)
```

**What must be stored**:
- For each table referenced by any shape's subquery join: candidate rows
  indexed by the join column(s).
- Bootstrap: one-time snapshot query per table (not per shape) at first
  use, then maintained incrementally from WAL.
- Indexed as "arrangements" keyed by join columns for O(delta) probing.

**Pros**:
- Actually achieves "no Postgres roundtrips for move-ins"
- Emits plain inserts/deletes (no tags/active_conditions needed)
- Restores transactional/causal properties for subquery shapes (no more
  "subqueries are eventual")
- Synchronous computation at WAL transaction boundary

**Cons**:
- Building/operating a partial replica + indexes inside the sync service
- Memory cost: O(|candidate rows|) per referenced table, shared across shapes
- Still needs one bootstrap snapshot query per table
- Significant engineering effort: row store, arrangement indexes, WAL-driven
  maintenance, garbage collection of unused table state

**When to choose**: When you need strong consistency guarantees for subquery
shapes, when move-in latency is a product-critical issue, or when Postgres
connection pool pressure from move-in queries is a scaling bottleneck.

### 4.2 Option B: DBSP Membership + PK Hydration (Simplified Queries)

**Concept**: DBSP computes exactly which primary keys became visible or
invisible. Electric still fetches row bodies from Postgres, but the query is
trivially simple: `SELECT * FROM tasks WHERE id = ANY($1)`.

**How it works**:

The membership engine maintains:
- The inner (subquery) result set — same as current Materializer
- A "membership set" of outer PKs currently in the shape

When a subquery change occurs:
1. DBSP membership engine computes: `{pk_3, pk_7, pk_12}` moved in
2. Hydration query: `SELECT * FROM tasks WHERE id = ANY('{3,7,12}')`
3. On hydration complete: validate each PK is still in membership set
   (handles races), emit inserts for confirmed rows
4. Move-outs: computed directly from membership delta, no query needed

**Architecture**:

```
┌─────────────────────────────────────────────────────────┐
│                Electric Sync Service                     │
│                                                          │
│  WAL ──► DBSP Membership Engine                          │
│              │ (tracks inner sets + outer PK membership)  │
│              │                                            │
│              ├── move-outs: emit deletes directly         │
│              │                                            │
│              └── move-ins: hydrate PKs from Postgres      │
│                     │                                     │
│                     ▼                                     │
│              Validate against current membership          │
│                     │                                     │
│                     ▼                                     │
│              Shape Log                                    │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP Shape Stream
                           ▼
                    TanStack DB (Client)
```

**What the membership engine needs**:
- The inner (subquery) result set: e.g., `{project_id: 1, project_id: 5}`
  — same data as current Materializer's `value_counts`
- An arrangement of outer PKs indexed by join column: e.g.,
  `{project_id: 1 → [task_3, task_7], project_id: 5 → [task_12]}`
  — this is new, but lightweight (just PKs, not full rows)

**Key simplification over current pipeline**:
- No DNF tags, no active_conditions, no exclusion clauses
- No snapshot positioning / touch_tracker races
- Hydration query is trivial (`WHERE pk = ANY($1)`) — no complex WHERE
  clause reconstruction
- On hydration complete, validate against DBSP membership state — if a PK
  left the set while the query was in flight, discard it. This single check
  replaces the entire moved_out_tags filtering system.
- Move-outs are synchronous (DBSP emits delete deltas directly)

**Pros**:
- Most of the conceptual simplification of DBSP without a server-side
  row store
- Hydration queries are simple, batched, and easy to reason about
- Move-outs require no queries at all (vs current control message system)
- Client protocol stays simple: inserts/deletes that reflect membership
- Significantly less engineering than Option A

**Cons**:
- Still hits Postgres for move-in row bodies (but simpler queries)
- Still async (hydration query returns later), though with much simpler
  race handling
- Subquery shapes remain "eventually consistent" for move-ins (though
  the window is smaller)
- Needs the outer PK arrangement (lightweight, but new state)
- **Move-out bandwidth**: A single inner-key removal (e.g., one project
  becomes inactive) can trigger deletion of *all* outer rows joined to
  that key — potentially 200k+ deletes in a single delta. This is
  semantically correct but may spike client bandwidth. Mitigation options:
  (a) batch deletes into chunked control messages, (b) send a "shape
  reset" signal above a threshold, (c) accept the spike as inherent to
  the query semantics. This is not unique to DBSP — the current pipeline
  has the same issue — but DBSP makes it synchronous and visible rather
  than spread across async moves.

**When to choose**: When you want the biggest simplification bang for the
buck. This is likely the **pragmatic first step** — it removes most of the
current pipeline's complexity while staying within the current architectural
envelope (Electric queries Postgres when it needs row bodies).

### 4.3 Option C: Client-Driven via TanStack DB Query-Driven Sync

**Concept**: Lean on TanStack DB's `requestSnapshot`/`fetchSnapshot`
mechanism. The server defines coarse shapes (possibly without subqueries);
the client's live queries drive subset loading as needed.

**How it works**:

TanStack DB's query-driven sync allows live queries to trigger subset
loading:
- Client query realizes it needs rows it hasn't loaded yet
- Calls `requestSnapshot` / `fetchSnapshot` to get more rows
- Joins can trigger batched ID fetches
- Electric's existing subset API (`query_subset` in `partial_modes.ex`)
  handles the server side

**Architecture**:

```
┌────────────────────────────────────────┐
│         Electric Sync Service           │
│                                         │
│  Shapes = coarse table boundaries       │
│  (simple WHERE, no subqueries)          │
│                                         │
│  Subset API handles on-demand fetches   │
└──────────────────┬─────────────────────┘
                   │ HTTP Shape Stream + Subset Requests
                   ▼
┌────────────────────────────────────────┐
│         TanStack DB (Client)            │
│                                         │
│  Electric Collections (coarse shapes)   │
│       │                                 │
│       ▼                                 │
│  d2ts live queries                      │
│  (joins, filters, subquery-equivalent   │
│   logic expressed as client queries)    │
│       │                                 │
│       ▼                                 │
│  Query-driven sync: requestSnapshot     │
│  for missing data as queries demand it  │
└────────────────────────────────────────┘
```

**Pros**:
- No incremental query engine on the server at all
- Leverages existing infrastructure (subset API, d2ts)
- Client has full data for its queries (d2ts works because data is local)
- Simplest server-side story

**Cons**:
- Shifts semantics: no longer "server pushes all rows that belong to a
  shape" but "client pulls subsets as queries demand"
- Security implications: if subqueries enforce authorization boundaries,
  the client can't be trusted to decide what to fetch. The server must
  still validate subset requests.
- Latency: client doesn't have data until it asks for it
- Not a replacement for server-enforced subquery shapes — it's a different
  product model
- Doesn't help with the server-side shape correctness problem at all

**When to choose**: When the subquery logic is a UI concern (not a security
boundary), and when the client is the right place to determine what data is
needed. This complements Options A/B rather than replacing them.

### 4.4 Option B.0: Incremental First Step (Reuse Existing Materializers)

**Concept**: The smallest possible step toward DBSP. Keep the existing
Materializer infrastructure for inner (subquery) result sets. Add only:
(a) outer PK arrangements, (b) DBSP membership evaluation, (c) PK
hydration, (d) pending hydration buffering. Don't build a generic DAG
compiler — hard-code the three patterns that currently break (NOT IN,
OR + subquery, multiple subqueries).

**How it differs from Option B**:
- Option B builds a full expression DAG compiler (Phase 2) and replaces
  the Materializer entirely
- Option B.0 reuses the Materializer as the source of inner set deltas
  and feeds them into hand-wired DBSP operators

**What changes**:
1. New: `Electric.DBSP.OuterArrangement` — per-table PK arrangement
   indexed by join columns, bootstrapped from a snapshot, maintained
   from WAL. Lightweight (PKs + join keys only).
2. New: `Electric.DBSP.MembershipEval` — takes Materializer change
   notifications + outer arrangement, computes membership delta
   (move-in PKs, move-out PKs). Replaces `MoveHandling` logic.
3. New: `Electric.DBSP.Hydration` — fetches row bodies for move-in
   PKs from Postgres (`SELECT * FROM t WHERE pk = ANY($1)`).
4. New: Pending hydration buffer (§9 Phase 3e) to handle the
   update-before-insert race.
5. Modified: `consumer.ex` — on materializer notification, call
   `MembershipEval` instead of `MoveHandling`.

**What stays the same**:
- Materializer GenServer (inner set tracking)
- `Parser.extract_subqueries`
- Shape dependency creation
- DependencyLayers ordering
- ShapeLogCollector / EventRouter / Filter dispatch

**Pros**:
- Smallest blast radius — most of the existing pipeline is untouched
- Immediately fixes NOT IN, OR, multi-subquery (the three patterns
  that currently cause invalidation)
- Validates the DBSP membership approach before committing to full
  compiler/DAG infrastructure
- Can ship behind feature flag with low risk

**Cons**:
- Doesn't eliminate DNF/tag complexity from the client protocol
  (though it makes it unnecessary — tags can be omitted for
  DBSP-evaluated shapes)
- Technical debt: two partially overlapping systems
- Doesn't generalize to new patterns without hand-wiring

**When to choose**: As the literal first step. Ship B.0, validate,
then build toward full Option B if the membership approach proves sound.

### 4.5 Comparison Matrix

| Dimension | Option A (Row Store) | Option B (Membership + Hydration) | Option B.0 (Incremental) | Option C (Client-Driven) |
|---|---|---|---|---|
| **Move-in latency** | ~μs (in-memory) | ~1-10ms (PG query) | ~1-10ms (PG query) | ~50-200ms (client roundtrip) |
| **Postgres load** | WAL only | Simple PK lookups | Simple PK lookups | Subset queries |
| **Electric memory** | High (candidate rows) | Medium (PK arrangements) | Medium (PK arrangements) | Low |
| **Engineering effort** | High | Medium | **Low** | Low (mostly exists) |
| **Consistency model** | Transactional | Eventually consistent (small window) | Eventually consistent (small window) | Eventually consistent |
| **Client protocol** | Simple (insert/delete) | Simple (insert/delete) | Compatible with existing | Existing (subset) |
| **NOT IN / OR / multi-subquery** | Full support | Full support | **Full support** | N/A (no server subqueries) |
| **Shared state** | Natural (per-table) | Natural (per-table) | Natural (per-table) | N/A |
| **Blast radius** | Large | Medium | **Small** | Small |

### 4.6 Recommended Path

**Start with Option B.0. Graduate to Option B. Evolve toward Option A
for hot tables.**

Option B.0 is the pragmatic first step: it immediately fixes the three
broken patterns (NOT IN, OR + subquery, multiple subqueries) with the
smallest possible change. It validates the DBSP membership approach
using the existing Materializer as a delta source.

Option B gives us 80% of the benefit (eliminates DNF, tags,
active_conditions, exclusion clauses, most race conditions) with 30% of
the effort. It's "DBSP for membership, Postgres for row bodies" — which
is an honest framing of what we actually need.

Option A is the long-term ideal for tables with high move-in traffic, but
it requires building a row store and arrangement infrastructure that is a
significant project in its own right. We can add it table-by-table later
when profiling shows hydration queries are a bottleneck.

Option C is complementary — it's how TanStack DB already works for UI-level
data needs. It doesn't solve the server-side subquery problem but it's a
good fit for "the client needs more data than the shape provides."

---

## 5. DBSP Theory — Minimal Subset We Need

### 5.1 Scoping: Don't Build a Generic Circuit DSL

The review correctly identifies that starting with "generic ZSet, operators,
circuit, then compiler" risks accidentally building a half-DB engine. The
pragmatic path is:

**Build arrangement-backed incremental operators directly (semi-join,
anti-join, filter, union) wired in a simple expression DAG. Only generalize
into a circuit DSL later if it's clearly paying off.**

### 5.2 What We Actually Need

For our shape SQL subset, the operators we need are:

| SQL Pattern | Incremental Operator | State Required |
|---|---|---|
| `WHERE pred(col)` | Lifted filter (stateless, linear) | None |
| `col IN (SELECT ...)` | Incremental semi-join | Inner set + outer PK arrangement |
| `col NOT IN (SELECT ...)` | Incremental anti-join (with NULL handling) | Inner set + outer PK arrangement + `inner_has_null` flag |
| `EXISTS (SELECT ... WHERE ...)` | Incremental semi-join | Same as IN |
| `NOT EXISTS (...)` | Incremental anti-join | Same as NOT IN (simpler NULL story) |
| `cond1 AND col IN (...)` | Filter composed with semi-join | Semi-join state |
| `cond1 OR col IN (...)` | Union + incremental distinct | Both branches' state + distinct state |
| `cond1 AND NOT cond2` | Difference (a - b) + distinct | Both branches' state + distinct state |
| Set intersection | Intersection (a ∩ b) | Both branches' state |

**Why intersection and difference?** Without them, compiling arbitrary
boolean ASTs requires converting to DNF first — the exact exponential
blowup we're trying to avoid. With all four set operations (union,
intersection, difference, distinct), the compiler can translate AND/OR/NOT
nodes directly:
- `A AND B` → intersection(A, B)
- `A OR B` → distinct(union(A, B))
- `NOT A` (within a conjunction) → difference(outer, A)

This keeps the operator set small (7 operators total) while avoiding DNF
entirely.

That's it. We don't need general-purpose projection, Cartesian product,
aggregation, or recursion to solve the subquery problem.

### 5.3 Core Theory We Use

**Z-sets**: Maps from rows (or PKs) to integer weights. Group operations
(+, -, 0) defined pointwise.

**Incremental semi-join** (from Theorem 3.4, bilinear):
```
Δ(a ⋉ b) = (Δa ⋉ Δb) + (prev_a ⋉ Δb) + (Δa ⋉ prev_b)
```
Where `prev_a` and `prev_b` are the accumulated state (integration) of
each input.

**Incremental anti-join**: derived from semi-join:
```
anti_join(a, b) = distinct(a - semi_join(a, b))
```
Incrementalized via the distinct H function (Proposition 4.7) composed with
the incremental semi-join and subtraction.

**Incremental distinct** (Proposition 4.7):
```
H(integrated, delta)[x] =
  +1  if integrated[x] ≤ 0 and (integrated + delta)[x] > 0
  -1  if integrated[x] > 0 and (integrated + delta)[x] ≤ 0
   0  otherwise
```

**Chain rule**: `(Q1 ∘ Q2)^Δ = Q1^Δ ∘ Q2^Δ` — incrementalize each
sub-operator independently.

**Linearity**: Filter and projection are linear, so their incremental
versions equal themselves: `σ^Δ = σ`. Just apply the filter to the delta.

---

## 6. Correctness Details: NULL Semantics and NOT IN

### 6.1 The Problem

The v1 plan said:
> NOT IN → anti-join: `distinct(outer - semi_join(outer, inner))`

That corresponds to `NOT EXISTS` semantics, not SQL `NOT IN` semantics
with NULLs.

In SQL:
- `x NOT IN (1, NULL)` is `UNKNOWN` → filtered out (effectively `false`)
- `NOT EXISTS (subquery WHERE subquery.y = x)` would be `true` if there's
  no matching row

### 6.2 Correct Translation

```
x NOT IN (subquery)
≈
x IS NOT NULL
AND NOT EXISTS (subquery WHERE subquery.y = x)
AND NOT EXISTS (subquery WHERE subquery.y IS NULL)
```

In incremental form:
1. Maintain a boolean `inner_has_null` flag, updated from the inner Z-set:
   `inner_has_null = ∃ row ∈ inner : row[col] IS NULL`
2. If `inner_has_null` is true: entire NOT IN evaluates to false for all
   outer rows (unless outer value is also NULL, which is also false)
3. If `inner_has_null` transitions true→false or false→true: **all** outer
   rows may change membership. This is an expensive case but correct.

### 6.3 Recommended Approach

**Rewrite IN/NOT IN at the query plan level:**

- `x IN (subquery)` → `EXISTS (subquery WHERE subquery.y = x)`
  (safe in WHERE context, avoids NULL complexity on the IN side)
- `x NOT IN (subquery)` → `x IS NOT NULL AND NOT EXISTS (subquery WHERE
  subquery.y = x) AND ¬inner_has_nulls`

The `inner_has_nulls` state is a single boolean maintained alongside the
inner Z-set. When it transitions, we emit a "full recompute" signal for the
anti-join portion — this is rare in practice (NULLs appearing/disappearing
in the subquery result) and acceptable.

### 6.4 Test Cases

These must be explicitly tested:

| Scenario | Expected |
|---|---|
| `NOT IN (1, 2)` where outer=3 | IN shape |
| `NOT IN (1, 2)` where outer=1 | NOT in shape |
| `NOT IN (1, NULL)` where outer=3 | NOT in shape (SQL semantics) |
| `NOT IN (1, NULL)` where outer=NULL | NOT in shape |
| Inner goes from `(1, 2)` to `(1, NULL)` | All non-matching outer rows leave shape |
| Inner goes from `(1, NULL)` to `(1, 2)` | Non-matching outer rows enter shape |

---

## 7. Performance: Arrangements, Not Naive Maps

### 7.1 The Problem

If `ZSet.join(...)` is implemented as "iterate all pairs matching key
extractors", it will not survive realistic loads. The v1 plan's data
structure was `%{row => weight}` — a flat map with no indexing.

### 7.2 Arrangements

An **arrangement** is a Z-set indexed by a key function. It's the
performance heart of differential dataflow / DBSP.

```elixir
defmodule Electric.DBSP.Arrangement do
  @type t(k, v) :: %{
    # Primary index: key → %{value => weight}
    index: %{optional(k) => %{optional(v) => integer()}},
    # Total count per key (for existence checks)
    counts: %{optional(k) => integer()}
  }

  @doc "Add a delta to the arrangement"
  def apply_delta(arrangement, delta, key_fn)

  @doc "Probe: given a key, return all values with positive weight"
  def probe(arrangement, key) :: %{optional(v) => integer()}

  @doc "Does this key exist with positive total weight?"
  def exists?(arrangement, key) :: boolean()
end
```

### 7.3 Incremental Semi-Join with Arrangements

```elixir
defmodule Electric.DBSP.SemiJoin do
  defstruct [
    :outer_arrangement,  # Arrangement indexed by join key
    :inner_arrangement,  # Arrangement indexed by join key
    :key_fn_outer,       # outer row → join key
    :key_fn_inner        # inner row → join key
  ]

  def step(state, delta_outer, delta_inner) do
    # 1. Δouter ⋉ (prev_inner + Δinner): probe inner arrangement for new outer rows
    from_new_outer = probe_semi_join(delta_outer, state.inner_arrangement, delta_inner, ...)

    # 2. prev_outer ⋉ Δinner: probe outer arrangement for new inner keys
    from_new_inner = probe_semi_join_reverse(state.outer_arrangement, delta_inner, ...)

    # 3. Update arrangements
    outer_arr = Arrangement.apply_delta(state.outer_arrangement, delta_outer, state.key_fn_outer)
    inner_arr = Arrangement.apply_delta(state.inner_arrangement, delta_inner, state.key_fn_inner)

    result = ZSet.add(from_new_outer, from_new_inner)
    {result, %{state | outer_arrangement: outer_arr, inner_arrangement: inner_arr}}
  end
end
```

The key insight: **delta rows probe the other side's index.** This is
O(|delta| × average_matches_per_key), not O(|delta| × |other_side|).

### 7.4 What Gets Arranged

For Option B (membership + hydration), the outer arrangement stores only
**primary keys grouped by join column**, not full rows:

```
outer_arrangement.index = %{
  project_id_1 => %{task_pk_3 => 1, task_pk_7 => 1},
  project_id_2 => %{task_pk_12 => 1}
}
```

This is lightweight — just PKs and join keys, not full row data. Full row
bodies are fetched from Postgres during hydration.

For Option A (candidate row store), the arrangement stores full rows:

```
outer_arrangement.index = %{
  project_id_1 => %{%{id: 3, name: "Task 3", ...} => 1, ...},
  ...
}
```

---

## 8. Shared State Across Shapes

### 8.1 The Problem

The v1 plan proposed one circuit per shape with its own integrated state.
If 100 shapes reference `projects WHERE active = true`, that's 100 copies
of the same inner set. And if 50 shapes filter on `tasks`, that's 50
copies of the tasks arrangement.

### 8.2 Per-Table Shared Arrangements

The natural solution: maintain arrangements **per table, per stack**, shared
across all shapes that reference that table.

```
┌─────────────────────────────────────────────┐
│  Shared Table State (per stack)              │
│                                              │
│  tasks:                                      │
│    arrangement(project_id) → {PKs}           │
│    arrangement(category_id) → {PKs}          │
│                                              │
│  projects:                                   │
│    arrangement(id) → {rows or PKs}           │
│    filter(active=true) → filtered set        │
└──────────────────────┬──────────────────────┘
                       │ shared, read by all shapes
                       ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Shape A  │  │ Shape B  │  │ Shape C  │
│ semi-join│  │ semi-join│  │ anti-join│
│ (tasks ⋉ │  │ (tasks ⋉ │  │ (tasks ▷ │
│  projs)  │  │  cats)   │  │  blocks) │
└──────────┘  └──────────┘  └──────────┘
```

### 8.3 Implementation Approach

- **Table state manager**: A GenServer per table (per stack) that receives
  WAL deltas and maintains arrangements.
- **Shape operators** read from shared arrangements but maintain their own
  incremental operator state (e.g., which PKs are currently in the
  semi-join result).
- **Reference counting**: When no shapes reference a table's arrangement,
  it can be garbage collected.
- **Current Materializer analogy**: The existing Materializer already shares
  dependency shapes across parents. This generalizes that pattern.

### 8.4 Arrangement Bootstrap and WAL Catch-up

This is a make-or-break correctness concern. If the arrangement starts
with the wrong data, or misses WAL events between snapshot and
subscription, every membership decision downstream is wrong.

#### 8.4.1 The Problem

When a shape first references table T (e.g., the `tasks` outer table),
the arrangement for T doesn't exist yet. We need to:
1. Snapshot the relevant columns + PKs
2. Build the initial arrangement
3. Subscribe to WAL for table T
4. Maintain incrementally from WAL deltas

The gap between steps 1 and 3 is dangerous: changes to T that happen
after the snapshot but before WAL subscription would be lost, making the
arrangement permanently inconsistent.

#### 8.4.2 Solution: Treat Arrangements as Internal "Table Shapes"

Electric already solves exactly this problem for regular shapes:
`SnapshotQuery.execute_for_shape` acquires a REPEATABLE READ snapshot,
records `pg_current_snapshot()` / LSN, then the consumer subscribes to
WAL from that LSN forward with gap-free delivery.

The pragmatic approach: **bootstrap arrangements using the same
snapshot + WAL catch-up pipeline that regular shapes use.** An
arrangement is effectively an internal, unpublished shape that:
- Has no HTTP consumer (no shape stream)
- Exists to serve other shapes' DBSP operators
- Stores only the columns needed for join keys + PKs (not full rows,
  for Option B)
- Is reference-counted: created when first needed, garbage collected
  when no shapes reference it

```
Arrangement lifecycle:
  1. Shape S is created with "tasks.project_id IN (SELECT ...)"
  2. MembershipEngine requests arrangement for tasks(project_id, pk)
  3. ArrangementManager checks: does this arrangement exist?
     - Yes: return reference, increment refcount
     - No: bootstrap it:
       a. Run snapshot: SELECT id, project_id FROM tasks
          (inside REPEATABLE READ, capture pg_current_snapshot() + LSN)
       b. Build initial arrangement from snapshot rows
       c. Subscribe to WAL for table tasks from the captured LSN
       d. Apply any WAL events that arrived between snapshot and now
       e. Mark arrangement as ready
  4. Shape S can now use the arrangement
  5. When Shape S is destroyed, decrement refcount
  6. When refcount reaches 0, arrangement is eligible for GC
```

#### 8.4.3 What Happens When a New Shape References a New Table Mid-Stream

If shapes A and B already exist and reference `tasks`, and shape C is
created with a subquery on `categories` (a table no existing shape
references):

1. Shape C's creation triggers arrangement bootstrap for `categories`
2. During bootstrap, shapes A and B continue processing WAL normally
3. Shape C buffers incoming WAL events for `categories` until the
   arrangement is ready (or delays processing — the consumer already
   handles this with `handle_continue` patterns)
4. Once the arrangement is ready, Shape C replays any buffered events
   and begins normal operation

This is the same pattern used when a new regular shape is created — the
consumer doesn't start processing until the initial snapshot is complete.

#### 8.4.4 WAL Catch-up Correctness

The key invariant: **the arrangement's state at any point must equal the
result of applying all WAL events from genesis to that point, as if
the arrangement had existed since the beginning of time.**

This is guaranteed by:
1. REPEATABLE READ snapshot gives a consistent point-in-time view
2. LSN capture at snapshot time gives the exact WAL position
3. WAL subscription from that LSN delivers all subsequent changes
4. No gap, no duplicates (Electric's existing ReplicationClient
   guarantees this for regular shapes)

The only new requirement: the WAL subscription for arrangement tables
must be established before or at the same time as the snapshot. In
practice, Electric already subscribes to WAL for all tables in the
publication — the arrangement just needs to register as a consumer
of events for its table, starting from the snapshot LSN.

#### 8.4.5 Arrangement Columns

For Option B (membership + hydration), arrangements store:
- Primary key column(s) of the table
- Join column(s) referenced by subquery expressions
- Any columns referenced in outer-only WHERE predicates (so the
  arrangement can filter without a Postgres round-trip)

For Option A (candidate row store), arrangements store full rows.

The column set is determined at arrangement creation time from the
union of all shapes that reference the table. If a new shape needs
an additional column, the arrangement must be rebuilt (or a new
arrangement created for the expanded column set).

### 8.5 Transaction Boundary Contract for Shared Arrangements

#### 8.5.1 The Problem

When a WAL transaction touches both `projects` (inner table) and
`tasks` (outer table), and multiple shapes reference the shared
arrangements for both tables, we need a clear contract for the order
of operations:

1. When does the `projects` arrangement update?
2. When does the `tasks` arrangement update?
3. When do shapes evaluate their DBSP operators?
4. What state do the operators see?

If the `projects` arrangement updates mid-evaluation of a shape's
semi-join, the operator might see an inconsistent snapshot (half-old,
half-new inner set).

#### 8.5.2 Three Viable Coordination Models

**Model 1: Global Step Coordinator**

A coordinator processes each WAL transaction as a single atomic step:
1. Compute deltas for all affected tables
2. Feed all deltas to all affected arrangements simultaneously
3. Run all affected shapes' DBSP operators with the consistent deltas
4. Collect all membership changes
5. Emit to shape logs

```
WAL txn → Coordinator
  → delta(projects), delta(tasks)
  → arrangements.apply_all(deltas)
  → for each shape: engine.step(deltas) → membership Δ
  → emit to shape logs
```

Pros: Strong consistency, simple mental model.
Cons: Sequential processing bottleneck, couples all shapes.

**Model 2: Table-Managers-Step-First**

Table arrangement managers process their deltas first (in parallel),
then shapes evaluate against the updated arrangements:

1. All table managers apply their deltas (parallel)
2. Barrier: wait for all managers to finish
3. All shapes evaluate their operators (parallel, reading from
   updated arrangements)

```
WAL txn
  → parallel: projects_mgr.apply(Δ), tasks_mgr.apply(Δ)
  → barrier
  → parallel: shape_A.step(), shape_B.step(), shape_C.step()
```

Pros: Parallelism in both phases. Arrangements are consistent.
Cons: Requires a two-phase protocol with a barrier. But note: the
existing DependencyLayers already implements exactly this pattern —
inner shapes evaluate before outer shapes. This model generalizes it.

**Model 3: No Sharing Initially**

Each shape maintains its own copy of the arrangements it needs.
No coordination required — each shape processes the WAL transaction
independently, updating its own arrangements and evaluating its
own operators atomically.

Pros: Simplest correctness story. No coordination protocol.
Cons: Redundant state (N copies of the same arrangement for N shapes).
Memory cost is manageable for Option B (PK arrangements are small).

#### 8.5.3 Recommendation

**Start with Model 3 (no sharing) for Option B.0.** PK arrangements
are lightweight (just PKs + join keys), so the memory cost of
per-shape copies is acceptable for the initial implementation. This
eliminates the coordination problem entirely and lets us ship faster.

**Graduate to Model 2 (table-managers-step-first) when implementing
full Option B.** This naturally extends the existing DependencyLayers
pattern: table arrangement managers are processed in layer 0 (they
have no dependencies), then shapes are processed in subsequent layers.
The barrier between layers is already built into the ConsumerRegistry
dispatch logic.

Model 1 (global coordinator) is only needed if we require strict
transactional semantics where a single WAL transaction's effects on
multiple shapes must be atomically visible. This is a stronger
guarantee than Electric currently provides and is unlikely to be
needed in the near term.

---

## 9. Implementation Plan (Pragmatic Path)

Based on the review's recommendation: **don't build a generic circuit DSL
first.** Build arrangement-backed incremental operators directly, wire them
in a simple expression DAG, and only generalize later.

### Phase 0: Arrangements and Z-set Primitives

**Goal**: Build the core data structures.

**Deliverables**:
- `Electric.DBSP.ZSet` — weighted set with group operations (+, -, 0)
- `Electric.DBSP.Arrangement` — indexed Z-set with probe/apply_delta
- Property-based tests: verify group laws, arrangement consistency

**Scope**: ~400-600 lines + tests.

**Key design decision**: Arrangements are the primary data structure, not
raw Z-sets. Every stateful operator works through arrangements.

**Files**:
- `lib/electric/dbsp/z_set.ex`
- `lib/electric/dbsp/arrangement.ex`
- `test/electric/dbsp/z_set_test.exs`
- `test/electric/dbsp/arrangement_test.exs`

### Phase 1: Incremental Operators

**Goal**: Implement the specific operators we need, backed by arrangements.

**Deliverables**:
- `IncrementalSemiJoin` — for IN / EXISTS
- `IncrementalAntiJoin` — for NOT IN / NOT EXISTS (with NULL handling)
- `IncrementalDistinct` — for OR combinations and set operations
- `IncrementalFilter` — lifted filter (stateless, for completeness)
- `IncrementalUnion` — for OR: `distinct(union(a, b))`
- `IncrementalIntersection` — for AND: `intersection(a, b)`
- `IncrementalDifference` — for NOT within conjunctions: `difference(a, b)`

Each operator:
- Takes delta Z-sets as input
- Maintains its own integrated state via arrangements
- Produces a delta Z-set as output
- Has a `bootstrap/2` function to initialize state from a snapshot

**Scope**: ~600-800 lines + tests.

**Files**:
- `lib/electric/dbsp/operators/semi_join.ex`
- `lib/electric/dbsp/operators/anti_join.ex`
- `lib/electric/dbsp/operators/distinct.ex`
- `lib/electric/dbsp/operators/filter.ex`
- `lib/electric/dbsp/operators/union.ex`
- `lib/electric/dbsp/operators/intersection.ex`
- `lib/electric/dbsp/operators/difference.ex`
- `test/electric/dbsp/operators/*_test.exs`

### Phase 2: Expression DAG Compiler

**Goal**: Translate shape WHERE clauses with subqueries into a DAG of
the operators from Phase 1.

**Deliverables**:
- `Electric.DBSP.QueryPlan` — structured representation of the query
- `Electric.DBSP.Compiler` — compiles a query plan into an operator DAG
- Integration with `Parser.extract_subqueries/1`

**Translations**:

```
WHERE col IN (SELECT x FROM t WHERE p)
→ SemiJoin(outer_arrangement(col), inner_arrangement(x, filter=p))

WHERE col NOT IN (SELECT x FROM t WHERE p)
→ AntiJoin(outer_arrangement(col), inner_arrangement(x, filter=p),
           null_tracking=true)

WHERE p1(col) AND col2 IN (SELECT ...)
→ Filter(p1) ∘ SemiJoin(...)

WHERE p1(col) OR col2 IN (SELECT ...)
→ Distinct(Union(Filter(p1, outer), SemiJoin(outer, inner)))

WHERE col IN (SELECT ...) AND col2 NOT IN (SELECT ...)
→ AntiJoin(SemiJoin(outer, inner1), inner2)
```

The NOT IN translation includes the NULL-aware rewrite from §6.

**Scope**: ~400-600 lines + tests.

**Files**:
- `lib/electric/dbsp/query_plan.ex`
- `lib/electric/dbsp/compiler.ex`
- `test/electric/dbsp/compiler_test.exs`

### Phase 3: Consumer Integration (Option B — Membership + Hydration)

**Goal**: Replace the Materializer + MoveHandling pipeline with the DBSP
membership engine, using PK hydration for move-in row bodies.

**Deliverables**:

#### 3a. Membership Engine

A new module that wraps the compiled operator DAG:

```elixir
defmodule Electric.DBSP.MembershipEngine do
  @doc "Process a WAL delta for one table, return membership changes"
  def step(engine, table, delta) :: {move_ins :: [pk], move_outs :: [pk], updated_engine}

  @doc "Bootstrap from initial snapshot"
  def bootstrap(engine, snapshot_rows) :: updated_engine
end
```

The engine maintains:
- Shared arrangements for referenced tables (via §8 shared state)
- Per-shape operator DAG state
- Current membership set (PKs in the shape)

#### 3b. Hydration Module

Replaces `MoveHandling.process_move_ins`:

```elixir
defmodule Electric.DBSP.Hydration do
  @doc "Fetch row bodies for moved-in PKs"
  def hydrate(pks, table, conn) :: [row]
  # Executes: SELECT * FROM table WHERE pk_col = ANY($1)

  @doc "Validate hydrated rows against current membership"
  def validate(rows, membership_engine) :: [confirmed_row]
  # Drop any rows whose PK left the membership set during the query
end
```

#### 3c. Consumer Wiring

Modify `consumer.ex` to use the membership engine:

```
WAL txn arrives:
  1. For each change, determine affected table
  2. Feed delta to MembershipEngine.step()
  3. Move-outs: emit DeletedRecord entries directly to shape log
  4. Move-ins: start Hydration.hydrate() (async, batched)
  5. On hydration complete: Hydration.validate() → emit NewRecord entries
  6. For root table changes that are already in the shape:
     emit UpdatedRecord as before
```

#### 3d. Multi-Table WAL Routing

Modify `Shape.list_relations/1` to return all tables referenced by the
shape (root + subquery tables). The existing Filter/EventRouter already
routes by relation — shapes just need to register for more tables.

```elixir
# In shape.ex
def list_relations(%__MODULE__{} = shape) do
  root = [{shape.root_table_id, shape.root_table}]
  subquery_tables = Enum.map(shape.shape_dependencies, fn dep ->
    {dep.root_table_id, dep.root_table}
  end)
  Enum.uniq(root ++ subquery_tables)
end
```

#### 3e. Pending Hydration Buffering (Correctness)

This addresses a subtle race condition that "validate against current
membership" alone does not solve.

**The problem (update-before-insert race)**:

```
Time 0: DBSP computes move-in for {pk_3, pk_7}
         Hydration query starts: SELECT * FROM tasks WHERE id IN (3, 7)
Time 1: WAL delivers UPDATE to tasks row pk_3 (e.g., name changes)
         DBSP evaluates: pk_3 is still in membership → emit UpdatedRecord
         But pk_3 has never been delivered to the client!
         → Client receives UPDATE for a row it doesn't have → broken
Time 2: Hydration completes, delivers pk_3 and pk_7
         → Client now has pk_3 but with stale data (pre-update)
         → pk_3's update from Time 1 was already emitted → lost
```

The root cause: between the membership decision (Time 0) and hydration
completion (Time 2), WAL events arrive for PKs that are *logically* in
the shape but have not yet been *delivered* to the client.

**Solution: Three-set tracking**

The membership engine tracks three sets per shape:

```
should_be_in     = set of PKs that DBSP says belong in the shape
delivered        = set of PKs that have been sent to the client
                   (via initial snapshot or completed hydration)
pending_hydration = set of PKs awaiting hydration
                    (= should_be_in - delivered, approximately)
```

**Invariant**: `pending_hydration ⊆ should_be_in` and
`pending_hydration ∩ delivered = ∅`.

**Buffering rules for WAL events during pending hydration**:

| Event | PK in `delivered` | PK in `pending_hydration` | PK in neither |
|---|---|---|---|
| UPDATE to root table row | Emit UpdatedRecord normally | **Buffer the update** | Ignore (not in shape) |
| DELETE from root table row | Emit DeletedRecord, remove from `delivered` | Remove from `pending_hydration`, cancel hydration for this PK | Ignore |
| DBSP says PK moves out | Emit DeletedRecord, remove from `delivered` | Remove from `pending_hydration` (no client action needed — never delivered) | N/A |
| DBSP says PK moves in | Should not happen (already in should_be_in) | Should not happen (already pending) | Add to `pending_hydration`, start hydration |

**On hydration complete for a batch of PKs**:

```
for each hydrated row (pk, row_body):
  if pk ∈ pending_hydration:
    1. Emit NewRecord(row_body)
    2. Move pk from pending_hydration to delivered
    3. Replay any buffered updates for pk (in WAL order)
    4. Drop the buffer for pk
  else:
    # pk was removed from pending_hydration (move-out or delete
    # arrived while hydration was in flight) → discard
```

**Buffer size concern**: The buffer holds at most one update per
pending PK (subsequent updates supersede). In the worst case, the
buffer size equals `|pending_hydration|` — the number of PKs
awaiting hydration. This is bounded by the move-in batch size
(configurable) and the hydration query latency.

**Implementation**:

```elixir
defmodule Electric.DBSP.PendingBuffer do
  defstruct [
    pending_hydration: MapSet.new(),  # PKs awaiting hydration
    buffered_updates: %{},           # pk → latest WAL change
    delivered: MapSet.new()           # PKs sent to client
  ]

  def on_move_in(buffer, pks)
  def on_move_out(buffer, pks)
  def on_wal_change(buffer, pk, change)
  def on_hydration_complete(buffer, hydrated_rows)
end
```

**Scope**: ~1000-1500 lines + tests (including pending buffer).

**Files**:
- `lib/electric/dbsp/membership_engine.ex`
- `lib/electric/dbsp/hydration.ex`
- `lib/electric/dbsp/pending_buffer.ex`
- Modify `lib/electric/shapes/consumer.ex`
- Modify `lib/electric/shapes/consumer/state.ex`
- Modify `lib/electric/shapes/shape.ex`
- `test/electric/dbsp/membership_engine_test.exs`
- `test/electric/dbsp/hydration_test.exs`
- `test/electric/dbsp/pending_buffer_test.exs`

### Phase 4: Remove Old Pipeline

Once Phase 3 is proven (feature-flagged, integration-tested):

- Remove `consumer/materializer.ex`
- Remove `consumer/move_handling.ex`
- Remove `consumer/move_ins.ex`
- Simplify `shape/subquery_moves.ex` (move tag logic may be retained for
  backward compatibility during transition, then removed)
- Remove `materializer_subscribed?`, `or_with_subquery?`,
  `not_with_subquery?`, `move_handling_state` from Consumer.State
- Remove the `should_invalidate?` check — DBSP handles all cases uniformly

### Phase 5 (Future): Candidate Row Store for Hot Tables (Option A)

When profiling shows hydration queries are a bottleneck for specific tables:

- Add a per-table row store (in-memory, WAL-maintained)
- Arrangements already exist from Phase 1 — extend them to store full rows
- Replace hydration queries with local row store lookups for those tables
- This is a per-table optimization, not a system-wide rewrite

---

## 10. Migration Strategy

### 10.1 Feature Flag Gating

```elixir
# In consumer.ex
if "dbsp_membership" in feature_flags do
  # DBSP membership engine for subquery processing
  MembershipEngine.step(state.membership_engine, ...)
else
  # Existing materializer + move handling
  ChangeHandling.process_changes(changes, state, ctx)
end
```

### 10.2 Incremental Rollout

1. **Phases 0-1**: Ship Z-sets, arrangements, operators with comprehensive
   tests. No user-visible changes. Property-based tests verify incremental
   results match full recomputation.

2. **Phase 2**: Ship compiler behind feature flag. Run shadow mode in
   integration tests: both pipelines process the same transactions, assert
   identical membership decisions.

3. **Phase 3 — first enable for broken cases**: Enable DBSP for shapes with
   subquery patterns that currently cause invalidation (NOT IN, OR, multiple
   subqueries). These shapes currently *don't work incrementally at all*,
   so DBSP is a pure improvement with no regression risk.

4. **Phase 3 — generalize**: Enable DBSP for all shapes with subqueries.
   Compare performance and correctness with existing pipeline via shadow
   mode and integration tests.

5. **Phase 4**: Remove old pipeline once DBSP is proven in production.

### 10.3 Correctness Validation

- **Property-based testing**: Generate random Z-sets and operations, verify
  `incremental_result == full_recomputation`.
- **Shadow mode oracle — use Postgres as ground truth**: The old pipeline
  is *not* a valid oracle — it's broken for OR, NOT IN, and
  multi-subquery patterns (that's why we're replacing it). Instead, the
  shadow mode oracle should be a **full Postgres query**: after each WAL
  transaction, execute the shape's complete SQL query against Postgres
  and compare the result set with the DBSP membership set. This is
  expensive (one query per transaction) but provides a ground-truth
  reference that doesn't depend on either pipeline being correct.
  Use this in integration tests, not production.
- **Existing test suite**: All tests in `test/integration/subquery_*_test.exs`
  and `test/electric/shapes/consumer_test.exs` must pass with DBSP enabled.
- **NULL-specific tests**: The test cases from §6.4.
- **Multi-subquery tests**: New tests for patterns that currently cause
  invalidation.
- **Pending buffer tests**: Specifically test the update-before-insert
  race from §9 Phase 3e, including: (a) UPDATE during hydration, (b) DELETE
  during hydration, (c) move-out during hydration, (d) re-move-in during
  hydration.

---

## 11. Open Questions and Decision Hinges

### 11.1 Resolved by This Plan

| Question | Answer |
|---|---|
| Where do row bodies come from? | Option B: Postgres PK hydration. Option A (future): local row store. |
| Generic circuit DSL? | No. Arrangement-backed operators in an expression DAG. |
| NOT IN semantics? | Rewrite to NOT EXISTS + inner_has_nulls flag. |
| Join performance? | Arrangements with indexed probing. |
| Shared state? | Per-table shared arrangements, reference counted. |
| Arrangement bootstrap? | Treat as internal "table shapes" using existing snapshot + WAL catch-up pipeline (§8.4). |
| Update-before-insert race? | Three-set tracking (should_be_in / delivered / pending_hydration) with buffering rules (§9 Phase 3e). |
| Transaction boundary contract? | Start with Model 3 (no sharing, per-shape copies), graduate to Model 2 (table-managers-step-first) (§8.5). |
| Smallest first step? | Option B.0: reuse existing Materializers, add only outer PK arrangements + membership eval + hydration + pending buffer (§4.5). |

### 11.2 Still Open

1. **Arrangement persistence**: Should arrangements survive Electric
   restarts, or cold-start from snapshot? Start with cold-start (correct,
   simpler). Add persistence later if restart latency is a problem.

2. **Arrangement memory limits**: For very large tables, the arrangement
   may not fit in memory. Options: (a) spill to disk, (b) evict
   arrangements for dormant shapes, (c) fall back to Postgres queries
   for tables above a size threshold.

3. **Transaction ordering within hydration**: When a hydration query
   returns, changes may have occurred since the query started. The
   validate-against-membership check handles correctness, but we need to
   decide whether to also replay any WAL deltas that arrived during
   hydration. (The simple answer: don't. Validate is sufficient.
   Subsequent deltas will be processed normally.)

4. **Client protocol backward compatibility**: Moving from move-out control
   messages to direct delete entries changes the wire format. Do we need a
   protocol version negotiation, or can we make the change transparently?
   (Likely transparent — deletes are already part of the protocol.)

5. **Move tag elimination timeline**: Move tags exist for client-side
   reconciliation. With DBSP emitting correct inserts/deletes, tags may be
   unnecessary. But if existing clients depend on them, we need a
   deprecation path.

### 11.3 The Two Decision Hinges

These determine whether DBSP is feasible and how far to go:

1. **Are we willing to maintain per-table arrangements (PK-indexed) inside
   Electric?** If yes → Option B is viable. If no → we're stuck with async
   Postgres queries and DBSP only helps with the compiler/expression side.

2. **Are we willing to maintain per-table full row stores inside Electric?**
   If yes → Option A is viable for hot tables. If no → Option B is the
   ceiling, and hydration queries remain.

---

## 12. File Inventory

### New Files

| File | Phase | Purpose |
|---|---|---|
| `lib/electric/dbsp/z_set.ex` | 0 | Weighted set with group operations |
| `lib/electric/dbsp/arrangement.ex` | 0 | Indexed Z-set with probe/apply_delta |
| `lib/electric/dbsp/operators/semi_join.ex` | 1 | Incremental semi-join (IN/EXISTS) |
| `lib/electric/dbsp/operators/anti_join.ex` | 1 | Incremental anti-join (NOT IN/NOT EXISTS) |
| `lib/electric/dbsp/operators/distinct.ex` | 1 | Incremental distinct (H function) |
| `lib/electric/dbsp/operators/filter.ex` | 1 | Lifted filter (stateless) |
| `lib/electric/dbsp/operators/union.ex` | 1 | Union for OR combinations |
| `lib/electric/dbsp/operators/intersection.ex` | 1 | Intersection for AND combinations |
| `lib/electric/dbsp/operators/difference.ex` | 1 | Difference for NOT within conjunctions |
| `lib/electric/dbsp/query_plan.ex` | 2 | Structured query plan representation |
| `lib/electric/dbsp/compiler.ex` | 2 | Query plan → operator DAG translation |
| `lib/electric/dbsp/membership_engine.ex` | 3 | Wraps DAG, tracks membership set |
| `lib/electric/dbsp/hydration.ex` | 3 | PK-based row body fetching + validation |
| `lib/electric/dbsp/pending_buffer.ex` | 3 | Three-set tracking for hydration race |
| `test/electric/dbsp/**/*_test.exs` | 0-3 | Tests for all DBSP modules |

### Modified Files

| File | Phase | Change |
|---|---|---|
| `lib/electric/shapes/consumer.ex` | 3 | Add membership engine; new change processing path |
| `lib/electric/shapes/consumer/state.ex` | 3 | Add `membership_engine` field |
| `lib/electric/shapes/shape.ex` | 3 | Expand `list_relations/1` for multi-table routing |
| `lib/electric/replication/eval/parser.ex` | 2 | Produce structured query plans |

### Eventually Removed Files

| File | Phase | Notes |
|---|---|---|
| `lib/electric/shapes/consumer/materializer.ex` | 4 | Replaced by shared arrangements |
| `lib/electric/shapes/consumer/move_handling.ex` | 4 | Replaced by membership engine |
| `lib/electric/shapes/consumer/move_ins.ex` | 4 | Replaced by membership engine state |
| `lib/electric/shapes/shape/subquery_moves.ex` | 4 | Tag logic may be retained during transition |

---

## 13. Summary

**The honest framing**: DBSP isn't "replace subquery processing with a
circuit." It's "replace Postgres-as-index with Electric-as-index" — and
that requires at minimum per-table PK arrangements, and at maximum a
full candidate row store.

**What DBSP buys us** (regardless of option chosen):
- Eliminates DNF expansion entirely
- Eliminates client protocol complexity (tags, active_conditions, synthetic
  deletes)
- Handles OR, NOT IN, multiple subqueries, and nested subqueries uniformly
  through composed operators
- Replaces the race-prone async move-in pipeline with deterministic
  membership computation

**The recommended path**: Start with Option B.0 (reuse existing
Materializers, add outer PK arrangements + membership eval + hydration +
pending buffer) as the smallest viable step. Graduate to full Option B
(expression DAG compiler, shared arrangements). Evolve toward Option A
(candidate row store) for hot tables where hydration latency matters.
Let Option C (TanStack DB query-driven sync) handle UI-level data needs
orthogonally.

**What the plan explicitly does NOT claim**: That DBSP eliminates all
Postgres queries. In Options B.0 and B, move-in still requires a simple
PK lookup. What it eliminates is the *complex orchestration around those
queries* (snapshot positioning, touch_tracker, moved_out_tags, exclusion
clauses, DNF expansion, client-side tags/active_conditions). That
orchestration is the source of most of the current pain.

**What v3 adds to the correctness story**:
- Arrangement bootstrap uses the existing snapshot + WAL catch-up pipeline
  (same correctness guarantees as regular shapes)
- Pending hydration buffering with three-set tracking prevents the
  update-before-insert race
- Transaction boundary contract starts simple (per-shape copies, no
  sharing) and graduates to table-managers-step-first (extending
  DependencyLayers)
