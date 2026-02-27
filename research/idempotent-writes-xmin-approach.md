# Research: Idempotent Writes — Using `xmin` for `awaitTxId`

## Context

A user is implementing idempotent writes for their sync endpoint and changed from
`pg_current_xact_id()` to querying `xmin` from the affected row after each write.
This document analyzes whether the `xmin` approach is correct and identifies edge cases.

## Root Cause: The Offline Retry Loop

The actual failure mode observed in production with offline transactions:

```
1. Client offline → makes optimistic mutation
2. Client comes online → mutationFn fires → plain INSERT succeeds (txid=100)
3. Response lost OR awaitTxId(100) times out (stream slow, connection drops)
4. TanStack DB treats mutation as failed → retries mutationFn
5. Retry INSERT → DUPLICATE KEY ERROR (row already exists from step 2)
```

The duplicate key error is the **symptom**. The root cause is `awaitTxId` timing
out, which triggers TanStack DB to retry the entire `mutationFn`.

**The fix requires two parts:**

1. **Make writes idempotent** — use `ON CONFLICT DO NOTHING` so retries don't error
2. **Handle the txid correctly on retry** — so `awaitTxId` resolves and stops the
   retry loop

Without part 2, fixing the error alone creates an infinite retry loop: each retry
is a no-op → returns a txid with no change in stream → `awaitTxId` times out again
→ retries again → forever.

## Background: How the txid Write-Path Works

The write-path contract in Electric + TanStack DB is:

1. Client performs an optimistic mutation on a collection
2. Collection's `onInsert`/`onUpdate`/`onDelete` calls the server API
3. Server writes to Postgres within a transaction, returns a `txid`
4. Client calls `collection.utils.awaitTxId(txid)` — watches the Electric shape
   stream for a change message whose `txids` header contains that value
5. When the matching change arrives, the optimistic state is dropped

### How Electric Gets the txid

- PostgreSQL's logical replication protocol sends a **32-bit xid** in the Begin
  message for each transaction
  ([`decoder.ex:67`](../packages/sync-service/lib/electric/postgres/logical_replication/decoder.ex))
- Electric attaches this xid to every change in the log as `txids: [xid]`
  ([`log_items.ex:45`](../packages/sync-service/lib/electric/log_items.ex))
- The TypeScript client receives `txids` as `number[]`
  ([`types.ts:137`](../packages/typescript-client/src/types.ts))

### Recommended SQL

```sql
SELECT pg_current_xact_id()::xid::text AS txid
```

- `pg_current_xact_id()` → 64-bit `xid8` (includes epoch)
- `::xid` → strips the epoch, producing the raw 32-bit value that matches the
  replication stream
- `::text` → decimal string for transport
- Client parses with `parseInt(txid, 10)` → JavaScript `number`

---

## Question 1: Is `xmin::text` the Correct Format?

**Yes.** The `xmin` system column is of type `xid` (32-bit). Casting it to text
(`xmin::text`) produces the same decimal string representation as
`pg_current_xact_id()::xid::text`. After `parseInt()`, the value will match what
Electric sends in the `txids` header of change messages.

Both produce: a **decimal string of a 32-bit unsigned integer**.

---

## Question 2: Is `xmin` Equivalent to `pg_current_xact_id()` for Successful Writes?

**Yes, for the row you just wrote.** When you INSERT a new row, the `xmin` of that
row is set to the current transaction's xid. So:

```sql
-- These produce the same 32-bit value for a row you just inserted:
SELECT xmin::text FROM table_name WHERE id = $1;
SELECT pg_current_xact_id()::xid::text;
```

The same holds for UPDATE — `xmin` is set to the xid of the transaction that
created the current tuple version.

---

## Question 3: Edge Cases

### 3a. The Core Win — Idempotent Retries (ON CONFLICT DO NOTHING)

This is the scenario that motivated the change, and it works correctly:

| Scenario | `pg_current_xact_id()` | `xmin` of existing row |
|---|---|---|
| First INSERT succeeds (txid=100) | 100 | 100 |
| Retry: INSERT ON CONFLICT DO NOTHING (txid=105) | **105** (new txid, no change in stream) | **100** (original txid) |

With `pg_current_xact_id()`:
- Returns 105, but **no change with txid=105 will ever appear** in the replication
  stream (because DO NOTHING produced no WAL entry)
- `awaitTxId(105)` **times out** — this is the bug they experienced

With `xmin`:
- Returns 100, which is the txid of the original INSERT
- That transaction's change **is already in** (or will arrive in) the Electric stream
- `awaitTxId(100)` **resolves correctly**

### 3b. Row Was Subsequently Updated by Another Transaction

If between the original INSERT and the retry, another transaction updated the row:

- `xmin` will be the UPDATE's txid (e.g., 103), not the original INSERT's (100)
- `awaitTxId(103)` is still correct — the UPDATE produced a change in the
  replication stream, and once that change is replicated, the row is visible
- In fact, this is *more* correct than returning the original INSERT txid, because
  the row's current state reflects the UPDATE

### 3c. Row Was Deleted Between Retry Attempts

If the row was deleted between the first attempt and the retry:

- The retry INSERT succeeds (no conflict) — this is a normal write, not idempotent
- `xmin` returns the current transaction's xid (same as `pg_current_xact_id()`)
- Works correctly — the new INSERT produces a change in the stream

**However:** the `SELECT xmin FROM table WHERE id = $1` query returns **no rows**.
The code must handle this case (e.g., fall back to `pg_current_xact_id()`, or
recognize that the INSERT succeeded).

### 3d. ON CONFLICT DO UPDATE (Upsert) Instead of DO NOTHING

If using `ON CONFLICT DO UPDATE SET col = EXCLUDED.col`:

- The row is always modified by the current transaction (even if values are identical)
- `xmin` = current transaction's xid = `pg_current_xact_id()::xid::text`
- Both approaches work identically
- **But:** this produces WAL traffic and replication events even for "no-op" updates,
  and may trigger unnecessary re-renders on other clients

### 3e. VACUUM FREEZE

After `VACUUM FREEZE`, PostgreSQL can replace `xmin` with `FrozenTransactionId` (2).
This would return a meaningless txid.

**In practice this is not a concern** — VACUUM FREEZE only affects rows older than
`vacuum_freeze_min_age` (default: 50 million transactions). Rows being actively
written to in a sync workflow will never be frozen.

### 3f. Multiple Tables in a Single Transaction

If a single API endpoint writes to multiple tables in one transaction:

- All rows written in the transaction will have the same `xmin`
- Reading `xmin` from any of them produces the correct value
- Equivalent to `pg_current_xact_id()` for normal writes

### 3g. Read-Only Transactions

If `pg_current_xact_id()` is called in a transaction that makes no changes, it still
assigns a transaction ID. With the `xmin` approach, if the INSERT was a no-op
(DO NOTHING) and you query the existing row's `xmin`, you get the *right* txid
(the one that actually produced a change). This is the key advantage.

---

## Marius's Question: Only Query xmin for Duplicates?

Marius asked whether `xmin` should only be used for duplicates, with
`pg_current_xact_id()` for normal writes.

**Tomas is correct** — for successful writes, `xmin` of the just-written row returns
the same 32-bit value as `pg_current_xact_id()::xid::text`. Using `xmin`
unconditionally is simpler and correct in both cases.

That said, there are two valid approaches:

### Approach A: Always Use `xmin` (Tomas's approach)

```sql
-- After INSERT/UPDATE/DELETE:
SELECT xmin::text FROM table_name WHERE id = $1;
```

- Simpler: one pattern for all cases
- Correct for both normal writes and idempotent retries
- **Caveat:** must handle the empty-result case (row deleted between write and SELECT)

### Approach B: Detect Duplicates, Use `pg_current_xact_id()` for Normal Writes

```sql
-- After INSERT ... ON CONFLICT DO NOTHING:
-- Check if the INSERT actually inserted (via RETURNING or affected rows count)
-- If inserted: SELECT pg_current_xact_id()::xid::text
-- If duplicate: SELECT xmin::text FROM table_name WHERE id = $1
```

- More explicit about what's happening
- Avoids the extra SELECT for normal writes
- More code to maintain

**Recommendation:** Approach A (always use `xmin`) is simpler and correct. The
performance difference of the extra SELECT is negligible compared to the transaction
itself.

---

## Alternative: ON CONFLICT DO UPDATE with RETURNING

Another pattern that avoids the issue entirely:

```sql
INSERT INTO table_name (id, col1, col2)
VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET col1 = EXCLUDED.col1, col2 = EXCLUDED.col2
RETURNING xmin::text AS txid;
```

- Always modifies the row → always produces a replication event
- `RETURNING xmin` gives the current transaction's xid in all cases
- No need for a separate SELECT
- **Downside:** produces WAL traffic and replication events for retries, which means
  other clients will see a spurious update

---

## Follow-up: Would an Infinite `awaitTxId` Timeout Work Instead?

Tomas asked whether simply increasing the `awaitTxId` timeout to infinity would
eliminate the need for the `xmin` approach, allowing them to continue using
`pg_current_xact_id()`.

### How `awaitTxId` Actually Resolves

Based on the TanStack DB `@tanstack/electric-db-collection` source, `awaitTxId`
resolves via **two mechanisms**:

1. **`seenTxids` store** — a `Set<number>` populated from `message.headers.txids`
   on change messages. When a batch of changes arrives and an `up-to-date` control
   message is received, all txids from that batch are committed to the set.

2. **`seenSnapshots` store** — an array of `PostgresSnapshot` objects (with
   `xmin`, `xmax`, `xip_list`) populated from `snapshot-end` control messages.
   Uses the `isVisibleInSnapshot()` function from `@electric-sql/client` to check
   if `txid < xmin || (txid < xmax && txid not in xip_list)`.

The function checks both stores immediately, resolving synchronously if the txid
is already known. Otherwise it subscribes to both stores and resolves when either
matches. The default timeout is **5000ms** (5 seconds).

### Why Infinite Timeout Does NOT Solve the Problem

Consider the DO NOTHING retry scenario:

```
1. Client starts shape stream → initial snapshot: xmin=90, xmax=100, xip=[]
2. First INSERT succeeds → txid=100 → change appears in stream
3. Network failure → client retries
4. Retry: INSERT ON CONFLICT DO NOTHING → pg_current_xact_id() = 105
5. Client calls awaitTxId(105)
```

At step 5, the `awaitTxId(105)` check:

- **seenTxids**: Does the set contain 105? **No** — no change message ever
  carries txid 105 (DO NOTHING produced no WAL entry)
- **seenSnapshots**: Is 105 visible in snapshot {xmin=90, xmax=100}?
  105 >= xmax → **No**

The function subscribes to both stores and waits. During normal live streaming:

- New change messages arrive with txids like 106, 110, 115... but never 105
  → `seenTxids` never contains 105
- **No new `snapshot-end` messages arrive during live streaming** — snapshots
  are only sent on initial load and `must-refetch`
  → No new snapshot to make 105 visible

**Result: `awaitTxId(105)` hangs forever**, regardless of timeout duration.

The only way it could resolve is if:
- A `must-refetch` triggers a new snapshot where `xmin > 105`
- The client reconnects and gets a fresh snapshot
- But these events are unpredictable and could take minutes, hours, or never happen

### Valter's Point: "Any txid >= current xmin will do"

Valter suggested that any txid >= the current snapshot's xmin should work because
"either you already received it, or will receive." This is true for txids that
**produce actual changes** — those txids will appear in `seenTxids` when the
corresponding change message arrives.

However, a DO NOTHING transaction's txid **never produces a change**, so it will
never appear in `seenTxids` regardless of its value relative to the snapshot.
Valter's logic holds for the `xmin` approach (where you return the txid of the
transaction that actually modified the row), but not for `pg_current_xact_id()` on
a no-op transaction.

### Recommendation

**The infinite timeout approach does not fix the root cause.** The fundamental
problem is that `pg_current_xact_id()` returns a txid with no corresponding change
in the replication stream. No amount of waiting will make that change appear.

---

## Simplest Approach: Skip `awaitTxId` for Duplicates

The cleanest solution is to **not call `awaitTxId` at all** when the write was a
no-op. If the INSERT is a duplicate (ON CONFLICT DO NOTHING, 0 rows affected),
nothing changed on the backend — the row already exists and its original INSERT
change is already in (or arriving in) the Electric stream. There's nothing new to
wait for.

### Implementation Pattern

```ts
// Server-side API endpoint
const result = await tx.execute(
  sql`INSERT INTO table_name (id, col1, col2)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING`
)

if (result.rowCount === 0) {
  // Duplicate — row already exists, no change produced
  return { txid: null }
}

// Successful write — get the txid to await
const txidResult = await tx.execute(
  sql`SELECT pg_current_xact_id()::xid::text AS txid`
)
return { txid: parseInt(txidResult.rows[0].txid, 10) }
```

```ts
// Client-side mutationFn / onInsert
onInsert: async ({ transaction }) => {
  const newTodo = transaction.mutations[0].modified
  const { txid } = await api.todos.create(newTodo)

  // If txid is null, it was a duplicate — nothing to await
  if (txid != null) {
    return { txid }
  }
  // Return without txid → optimistic state is dropped immediately
}
```

### Why This Works

- **Duplicate INSERT**: The row already exists in Postgres. The original INSERT's
  change is already in the shape stream (or will arrive from the original
  transaction). The optimistic state shows the same data as the synced row, so
  dropping it immediately is correct — TanStack DB deduplicates.
- **Successful INSERT**: Normal `pg_current_xact_id()` path works as before.
- **No extra queries**: No `SELECT xmin` needed. No infinite timeouts. Just check
  the affected row count.

### Comparison of All Approaches

| Approach | Duplicate handling | Extra queries | Complexity |
|---|---|---|---|
| `pg_current_xact_id()` only | **Broken** — awaitTxId times out | None | Low |
| Always use `xmin::text` | Works — returns original txid | 1 SELECT per write | Low |
| Skip awaitTxId for duplicates | Works — returns immediately | None for duplicates | Low |
| `ON CONFLICT DO UPDATE ... RETURNING xmin` | Works — always produces change | None | Low, but extra WAL |
| Infinite timeout | **Broken** — hangs forever | None | Low |

**Recommendation:** The "skip awaitTxId for duplicates" approach is the simplest
and most correct. It avoids unnecessary `xmin` queries, avoids extra WAL traffic,
and directly addresses the root cause: a no-op transaction has nothing to wait for.

The `xmin` approach also works and may be preferable if you want a single code path
that always returns a txid (e.g., for logging or debugging). But the skip approach
has fewer moving parts.

---

## Summary

| Question | Answer |
|---|---|
| Is `xmin::text` the correct format? | **Yes** — same 32-bit xid format that Electric sends in the `txids` header |
| Equivalent to `pg_current_xact_id()` for normal writes? | **Yes** — identical value for rows modified in the current transaction |
| Key advantage of `xmin` approach | Returns the txid that *actually produced a change* in the replication stream, not a new txid for a no-op transaction |
| **Simplest approach for duplicates** | **Skip `awaitTxId` entirely** — if 0 rows affected, return no txid; nothing changed, nothing to wait for |
| Main edge case to handle | Row deleted between attempts → retry INSERT succeeds normally (not a duplicate) |
