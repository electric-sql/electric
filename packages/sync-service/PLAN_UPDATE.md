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

## Solution: Materialized-State Exclusion with LSN-Keyed Snapshots

Replace live subquery exclusion with **parameter-based exclusion** (`= ANY($values)`)
using the materialized state known to the consumer. The correct materialized state to use
is determined by querying the materializer for a specific LSN.

### Why the Consumer Can't Just Use Current Materialized State

The materializers process in an earlier dependency layer. By the time the outer consumer
handles `materializer_changes` from dependency A, dependency B's materializer has
**already updated** to reflect the current transaction. Querying B's current state would
return post-transaction values — but the consumer hasn't started B's move-in yet. Using
post-transaction state for exclusion reproduces the original bug.

### LSN-Keyed Value Counts in the Materializer

Each materializer maintains a map of `lsn → value_counts` with **at most 2 entries**,
evicting the oldest when a third arrives. Each entry stores the value_counts as they were
after processing changes at that LSN.

```
# After initial snapshot (lsn_0):
%{lsn_0 => %{gb_1: 1}}

# After a later transaction (lsn_5) that adds gb_2:
%{lsn_0 => %{gb_1: 1}, lsn_5 => %{gb_1: 1, gb_2: 1}}
```

The materializer exposes a single API: `get_link_values(lsn)`:

- **Exact match:** if `lsn` matches one of the stored entries, return that entry's
  value_counts.
- **LSN 0 (sentinel):** return the value_counts for the **minimum** stored LSN.

Move event messages (`{:materializer_changes, dep_handle, events}`) are extended to
include the LSN of the transaction that produced the changes:
`{:materializer_changes, dep_handle, events, lsn}`.

### LSN-per-Dep Tracking in the Consumer

The consumer maintains a map of `dep_handle → lsn` (replacing the boolean `seen_deps`
set). This is updated when the consumer receives a `materializer_changes` message from
that dep.

When building the exclusion context for dependency D:

- **D has a recorded LSN** (consumer has processed D's `materializer_changes` at some
  point): call `D.get_link_values(recorded_lsn)`. This returns the value_counts as of
  the last transaction where D changed and the consumer processed it.

- **D has no recorded LSN** (consumer has never received `materializer_changes` from D):
  call `D.get_link_values(0)`. The materializer returns the minimum LSN entry — the
  post-snapshot value_counts.

### Why This Handles All Cases

| Dependency state | Consumer has LSN? | `get_link_values` arg | Returns | Correct? |
|---|---|---|---|---|
| Changed in this txn, already processed | Yes (current txn LSN) | current txn LSN | Post-change values | Move-in started, rows claimed |
| Changed in this txn, not yet processed | Yes (older LSN) | older LSN | Pre-change values | New values not yet claimed |
| Changed in prior txn | Yes (prior txn LSN) | prior txn LSN | Values after that txn | Stable state, correct |
| Never changed after snapshot | No | 0 (sentinel) | Post-snapshot values | Stable state, correct |

### Worked Example

Same scenario. Processing order: subqueryX first, then subqueryY.

**Step 1: Process subqueryX's `materializer_changes` (x1 added, lsn=100)**

- Record `subqueryX → lsn 100`
- SubqueryY has recorded LSN from a prior txn (or 0 if never seen)
- `subqueryY.get_link_values(prior_lsn)` → pre-txn Y (does not contain `y1`)
- Move-in query: `WHERE x = 'x1' AND NOT (y = ANY($Y_values))`
- `t1`: `y1` not in Y values → **t1 returned**

**Step 2: Process subqueryY's `materializer_changes` (y1 added, lsn=100)**

- Record `subqueryY → lsn 100`
- SubqueryX has recorded `lsn 100`
- `subqueryX.get_link_values(100)` → post-change X (contains `x1`)
- Move-in query: `WHERE y = 'y1' AND NOT (x = ANY($X_values))`
- `t1`: `x1` in X values → **t1 excluded** (no duplicate)

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

SubqueryX adds `x1` in T1 (lsn=100), subqueryY adds `y1` in T2 (lsn=200):

- T1: subqueryY's recorded LSN is 0 or from a prior txn → returns stable Y values
  (no `y1`) → `t1` returned by subqueryX move-in
- T2: subqueryX's recorded LSN is 100 → `subqueryX.get_link_values(100)` returns values
  containing `x1` → `t1` excluded by subqueryY move-in

Stable deps return current values regardless of which LSN is requested (they only have
one entry in their map), so cross-transaction works identically.
