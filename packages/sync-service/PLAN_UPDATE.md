# Plan Update: Materialized-State Exclusion Clauses

## Problem: Live Subquery Exclusion Causes Missed Move-ins

The current implementation plan (Phase 7a in `IMPLEMENTATION_PLAN.md`) and the RFC
(`docs/rfcs/arbitrary-boolean-expressions-with-subqueries.md`, lines 232–245) specify that
move-in exclusion clauses use **live subqueries** against Postgres. This is broken when
multiple subqueries change concurrently, because each move-in's exclusion sees the other
subquery's changes as already committed — both queries exclude the row, and it is never
delivered to the client.

### Concrete Example

**Shape:** `WHERE x IN (subqueryX) OR y IN (subqueryY)` on table `t`

| id | x  | y  |
|----|----|----|
| t1 | x1 | y1 |
| t2 | x2 | y2 |

**Transaction:** subqueryX adds `x1`, subqueryY adds `y1`.

After this transaction, `t1` matches the shape (via `x1 IN subqueryX`). It should move in.

**What happens with live exclusion:**

Move-in for subqueryX: `WHERE x = 'x1' AND NOT (y IN (SELECT ... subqueryY))`
- By query execution time, subqueryY already contains `y1` → exclusion fires → **t1 excluded**

Move-in for subqueryY: `WHERE y = 'y1' AND NOT (x IN (SELECT ... subqueryX))`
- subqueryX already contains `x1` → exclusion fires → **t1 excluded**

**Result:** `t1` missed by both queries. Correctness bug.

The exclusion assumes the other disjunct's move-in already claimed the row. When both
change in the same transaction, neither has — they each defer to the other.

---

## Solution: Materialized-State Exclusion with Seen/Unseen Tracking

Replace live subquery exclusion with **parameter-based exclusion** (`= ANY($values)`)
using the materialized state known to the consumer. The correct materialized state to use
depends on whether the consumer has already processed that dependency's changes.

### Why the Consumer Can't Just Use Current Materialized State

The materializers process in an earlier dependency layer. By the time the outer consumer
handles `materializer_changes` from dependency A, dependency B's materializer has
**already updated** to reflect the current transaction. Querying B's current state would
return post-transaction values — but the consumer hasn't started B's move-in yet. Using
post-transaction state for exclusion reproduces the original bug.

### Seen vs Unseen Dependencies

The consumer tracks which dependencies' `materializer_changes` it has processed
(a `seen_deps` set). When building an exclusion clause for dependency D in another
disjunct:

- **D is seen** (consumer already processed D's `materializer_changes`): use D's
  **current** materialized state. D's move-in has been started — any matching rows will
  be claimed.

- **D is unseen** (consumer hasn't processed D's `materializer_changes` yet): use D's
  **pre-transaction** materialized state. This excludes rows already in the shape from
  previous transactions, without falsely excluding rows matching D's newly-added values
  (which no move-in has claimed yet).

To support pre-transaction queries, the materializer retains its previous state
(`prev_value_counts`), saved before applying each transaction's changes.

### Why This Handles All Cases

| Dependency state | Seen? | Which materialized state? | Correct? |
|------------------|-------|---------------------------|----------|
| Changed in this txn | Yes | Current (post-txn) | Move-in started, rows will be claimed |
| Changed in this txn | No | Pre-txn | New values not yet claimed, old values already in shape |
| Stable (no change) | N/A | Pre-txn = current (identical) | Either works |

### Worked Example

Same scenario. Processing order: subqueryX first, then subqueryY.

**Step 1: Process subqueryX's `materializer_changes` (x1 added)**

- Mark subqueryX as **seen**
- SubqueryY is **unseen** → exclusion uses pre-txn Y (does not contain `y1`)
- Move-in query: `WHERE x = 'x1' AND NOT (y = ANY($prev_Y))`
- `t1`: `y1` not in pre-txn Y → **t1 returned**

**Step 2: Process subqueryY's `materializer_changes` (y1 added)**

- Mark subqueryY as **seen**
- SubqueryX is **seen** → exclusion uses current X (contains `x1`)
- Move-in query: `WHERE y = 'y1' AND NOT (x = ANY($current_X))`
- `t1`: `x1` in current X → **t1 excluded** (no duplicate)

**Result:** `t1` returned exactly once. Order doesn't matter — whichever dependency is
processed first claims the row.

### How Position 1 Becomes Active for t1

The first move-in query returns `t1` with **tags at all positions** (tags are derived
from column values, always computed). So `t1` has `hash(y1)` at position 1.

The second move-in doesn't return `t1` in its query results — but it doesn't need to.
The **move-in broadcast** for position 1 is a control message written to the log
independently of the query. The client already has `t1`, matches `hash(y1)` against
position 1's tag, and activates position 1.

Exclusion prevents duplicates in the **data path** (query results). Broadcasts handle
activation in the **control path** (position state updates).

### Cross-Transaction Scenario

SubqueryX adds `x1` in T1, subqueryY adds `y1` in T2:

- T1: subqueryY unseen, pre-txn Y has no `y1` → `t1` returned by subqueryX move-in
- T2: subqueryX unseen, pre-txn X has `x1` (stable from T1) → `t1` excluded by
  subqueryY move-in

Pre-txn state for stable deps equals current state, so cross-transaction works
identically.
