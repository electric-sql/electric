---
title: "RFC: Arbitrary Boolean Expressions with Subqueries"
version: "1.0"
status: draft
owner: rob
contributors:
  - ilia
  - kev
created: 2026-01-27
last_updated: 2026-01-27
prd: N/A
prd_version: N/A
---

# RFC: Arbitrary Boolean Expressions with Subqueries

## Summary

This RFC extends Electric's subquery support from single `IN (SELECT ...)` conditions to arbitrary boolean expressions containing multiple subqueries combined with AND, OR, and NOT. It introduces a DNF-based tag structure with per-row `active_conditions` that enables efficient move-in/move-out handling without requiring Postgres queries when rows are already present for another reason.

## Background

Electric currently supports subqueries in WHERE clauses (e.g., `SELECT * FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE ...)`). This works well for single subqueries but has limitations:

1. **OR with subqueries returns 409** — `WHERE x IN subquery1 OR y IN subquery2` causes shape invalidation on move-ins because we can't determine which condition changed
2. **NOT with subqueries unsupported** — `WHERE x NOT IN (SELECT ...)` doesn't handle move-in/move-out correctly
3. **Multiple subqueries at same level** — Complex boolean combinations require client refresh

The existing RFC ["Move-in/Move-out Handling for Shapes with Subqueries"](./algorithm-for-move-ins-out-with-subqueries.md) established the foundation with tagging and noted that "all where clauses can be converted to a DNF form."

Ilia's DNF decomposer (`ilia/dnf-form` branch) provides the algorithm to convert arbitrary WHERE clauses to Disjunctive Normal Form, enabling this extension.

## Problem

Users need shapes with complex WHERE clauses combining multiple subqueries:

```sql
-- Current: returns 409 on move-in
WHERE (project_id IN (SELECT id FROM projects WHERE active) AND status = 'open')
   OR (assigned_to IN (SELECT id FROM users WHERE role = 'admin'))

-- Current: not supported
WHERE project_id NOT IN (SELECT id FROM archived_projects)
```

The current implementation can't track which conditions caused a row's inclusion, making move-in/move-out handling impossible without full shape invalidation.

**Link to PRD hypothesis:** Enables Electric to support real-world filtering patterns where data access depends on multiple dynamic criteria.

## Goals & Non-Goals

### Goals

- Support arbitrary AND/OR/NOT combinations of subquery conditions
- Support mixed conditions: subqueries combined with field-based filters
- Efficient move-in: avoid Postgres queries when row is already present for another reason
- Move-in/move-out as broadcasts to clients, not per-row targeted updates
- Backward compatible: existing single-subquery shapes continue working
- Client logic remains simple: evaluate tags against `active_conditions` bitmask

### Non-Goals

- Client-side condition evaluation (clients don't parse WHERE clauses)
- Optimizing for shapes with dozens of subqueries (reasonable limit ~10)
- Real-time subquery result caching across shapes
- Supporting subqueries in SELECT clause (only WHERE)

## Proposal

### Overview

Convert WHERE clauses to Disjunctive Normal Form (DNF), where each disjunct is a conjunction of atomic conditions. Each position in the DNF corresponds to a condition that can be independently activated/deactivated.

For a row:
- **Tags**: One flat array per disjunct, containing hashed values at positions that participate
- **`active_conditions`**: Flat boolean array indicating which positions are currently satisfied

Client evaluates: for each tag, AND the `active_conditions` at non-null positions, then OR all tag results.

### DNF Decomposition

Use the `Electric.Replication.Eval.Decomposer` module to convert WHERE clauses:

```elixir
# Input: WHERE (x IN subquery1 AND status = 'active') OR y IN subquery2
# Output:
{disjuncts, subexpressions} = Decomposer.decompose(where_ast)

# disjuncts = [
#   [ref1, ref2, nil],     # (x IN subquery1 AND status = 'active')
#   [nil, nil, ref3]       # y IN subquery2
# ]
#
# subexpressions = %{
#   ref1 => "x IN (SELECT ...)",
#   ref2 => "status = 'active'",
#   ref3 => "y IN (SELECT ...)"
# }
```

Position mapping:
- Position 0: `x IN subquery1`
- Position 1: `status = 'active'`
- Position 2: `y IN subquery2`

### Tag Structure

Each row can have multiple tags (one per disjunct it could satisfy):

```
Row with x='a', status='active', y='b':

tags: [
  [hash(a), hash(active), _],   # could match disjunct 1
  [_, _, hash(b)]                # could match disjunct 2
]

active_conditions: [true, true, false]
# Position 0 (x IN subquery1): 'a' is in subquery1 → true
# Position 1 (status = 'active'): field matches → true
# Position 2 (y IN subquery2): 'b' is NOT in subquery2 → false
```

Client evaluation:
- Tag 1: `active_conditions[0] AND active_conditions[1]` = true AND true = **true**
- Tag 2: `active_conditions[2]` = **false**
- Result: true OR false = **included**

### Negation Handling

NOT conditions are handled via De Morgan's laws in the decomposer:
- `NOT (a OR b)` → `(NOT a) AND (NOT b)`
- `NOT (a AND b)` → `(NOT a) OR (NOT b)`

Negation is encoded by **position**, not value. For `WHERE x IN subquery OR x NOT IN subquery`:

```
Positions:
- Position 0: x IN subquery (positive)
- Position 1: x NOT IN subquery (negated)

Row with x='a' where 'a' is in the subquery:
tags: [[hash(a), _], [_, hash(a)]]
active_conditions: [true, false]
# Position 0: 'a' is in subquery → true
# Position 1: 'a' is in subquery, so NOT IN is false → false
```

The server tracks which positions are negated. When 'a' moves into the subquery:
- Position 0 activates (positive condition now true)
- Position 1 deactivates (negated condition now false)

Clients see the same hash value at different positions with opposite activation.

### Tag Value Hashing

Tags use the existing hashing scheme for opacity:

```elixir
hash = md5(stack_id <> shape_handle <> namespaced_value)
```

Where `namespaced_value` is:
- `"v:" <> value` for non-null values
- `"NULL"` for null values

### Message Format

#### Row Messages

Extend existing insert/update/delete messages with `active_conditions`:

```json
{
  "key": "public.tasks/123",
  "value": {"id": 123, "title": "..."},
  "headers": {
    "operation": "insert",
    "tags": [
      ["abc123", "def456", null],
      [null, null, "ghi789"]
    ],
    "active_conditions": [true, true, false]
  }
}
```

For updates, include both `tags` and `removed_tags` as today, plus `active_conditions`.

#### Move-in/Move-out Messages

New control message types for broadcasting condition changes:

```json
["move-in", {"position": 0, "values": ["hash1", "hash2", "hash3"]}]
["move-out", {"position": 2, "values": ["hash4", "hash5"]}]
```

- `position`: Which condition position changed
- `values`: Hashed values that moved in/out (batched for efficiency)

Clients update `active_conditions[position]` for all rows with matching values at that position.

### Initial Snapshot Query

Compute both tags and `active_conditions` in SQL:

```sql
SELECT
  -- Condition results for active_conditions
  (x IN (SELECT id FROM subquery1)) as cond_0,
  (status = 'active') as cond_1,
  (y IN (SELECT id FROM subquery2)) as cond_2,
  -- Tags (hashed values per disjunct)
  ARRAY[
    md5('...' || x_value) || '/' || md5('...' || status),
    md5('...' || y_value)
  ] as tags,
  -- Row data
  id, title, ...
FROM tasks
WHERE (x IN (SELECT ...) AND status = 'active')
   OR (y IN (SELECT ...))
```

PostgreSQL's optimizer deduplicates identical subexpressions between SELECT and WHERE.

### Move-in Query

When value 'a' moves into subquery at position 0:

1. **Broadcast activation** — Send `["move-in", {"position": 0, "values": ["hash(a)"]}]`

2. **Query for new rows** — Rows not already in shape:
   ```sql
   SELECT
     (true) as cond_0,  -- we know x='a' matches
     (status = 'active') as cond_1,
     (y IN (SELECT ...)) as cond_2,
     ...
   FROM tasks
   WHERE x = 'a' AND status = 'active'
     AND NOT (y IN (SELECT ...))  -- exclude rows already sent via disjunct 2
   ```

The `NOT (other_disjuncts)` clause excludes rows already in the shape for another reason.

### Snapshot Positioning

Move-in queries run ahead of the replication stream. We reuse the existing snapshot-based positioning mechanism:

1. **REPEATABLE READ transaction** — Query runs in `REPEATABLE READ READ ONLY` isolation
2. **Capture pg_snapshot** — `SELECT pg_current_snapshot()` returns `(xmin, xmax, xip_list)`
3. **Stream filtering** — Skip replication stream changes already visible in query snapshot
4. **Touch tracking** — Track keys modified in stream to skip stale query results
5. **Correct ordering** — Query results spliced into shape log at correct position

This ensures query results appear at the right point in the stream without shadowing concurrent changes. See `Electric.Shapes.Consumer.MoveIns` for implementation details.

### Move-out Handling

When value 'a' moves out of subquery at position 0:

1. **Broadcast deactivation** — Send `["move-out", {"position": 0, "values": ["hash(a)"]}]`

2. **Client evaluates** — For each row with `hash(a)` at position 0:
   - Set `active_conditions[0] = false`
   - Re-evaluate all tags
   - If no tag evaluates to true, delete the row

No server query needed — clients have all information to determine if row should be removed.

### Race Condition Handling

#### Replication stream ordering and dependency layers

The replication stream delivers one transaction at a time as a sequence of operations
(`begin op op op end begin op op end ...`). The `ShapeLogCollector` publishes each
transaction to consumers via `ConsumerRegistry.publish`, which is a synchronous
broadcast — it sends the event to every consumer in the layer and waits for all of them
to return before moving on.

Crucially, `DependencyLayers` organises shapes into layers based on their dependency
relationships. Inner (subquery) shapes are in earlier layers; outer shapes are in later
layers. The `ShapeLogCollector` publishes to layers in order (line 550 of
`shape_log_collector.ex`):

```elixir
for layer <- DependencyLayers.get_for_handles(state.dependency_layers, affected_shapes) do
  # Each publish is synchronous, so layers will be processed in order
  ConsumerRegistry.publish(layer_events, state.registry_state)
end
```

This means that for any transaction T:
1. The inner shape's `handle_event` runs first and returns
2. If T caused move-ins/outs, the inner shape sends `materializer_changes` to the outer
   consumer (a regular `send`, so it lands in the outer consumer's mailbox)
3. Only then does the outer shape's `handle_event` run (as a `handle_call`)

Since GenServer processes messages in mailbox order, and the `materializer_changes`
message was sent *before* the `handle_event` call message, the outer consumer always
processes `materializer_changes` before `handle_event` for the same transaction.

#### Why the touch_tracker race is benign

The `touch_tracker` prevents move-in query results from overwriting fresher data in the
stream. It records `{key → xid}` during `handle_event` and skips query result rows where
the touch xid is *not* visible in the query's snapshot (meaning the stream has newer data).

At first glance, there appears to be a race: `materializer_changes` starts an async
move-in query, and `query_complete` could fire before the touch_tracker is populated by a
later `handle_event`. But this race is benign because of how transaction ordering works:

1. **Previous transactions are already processed.** The replication stream delivers
   transactions in commit order, one at a time. By the time a move-in query starts, every
   previously delivered transaction has been fully processed via `handle_event`, so their
   touch_tracker entries are present. Since those transactions committed before the query
   started, they are always visible in the query's snapshot — the touch_tracker says
   "visible → don't skip", which is correct.

2. **The triggering transaction is always in the query's snapshot.** The move-in query
   starts *after* the triggering transaction committed (the subquery consumer had to
   process it first). So the query snapshot includes the triggering transaction's changes.
   Any touch_tracker entries from the triggering transaction would say "visible → don't
   skip" — the same result as having no entry at all.

3. **Future transactions may or may not be in the query's snapshot.** If a future
   transaction T_next commits and is processed via `handle_event` while the query is in
   flight, two cases arise:
   - **`handle_event` runs before `query_complete`:** Touch_tracker has T_next's entries.
     If T_next's xid is not visible in the query snapshot, stale rows are correctly
     skipped.
   - **`query_complete` runs before `handle_event`:** Touch_tracker is missing T_next's
     entries. But if T_next committed after the query's snapshot, the query doesn't have
     T_next's changes either — the query results reflect the pre-T_next state, which is
     correct for the consumer's current stream position. If T_next committed before the
     snapshot, the query has T_next's version (same as what the stream will deliver), so
     including it produces at worst a same-version duplicate.

4. **Subquery-only transactions don't need touch_tracker entries.** When a transaction
   only modifies the subquery table, the outer consumer receives `materializer_changes`
   but no `handle_event` (no changes to the outer table). This is correct — there are no
   stream changes to deduplicate against, so the touch_tracker is correctly empty.

In all cases, the worst outcome of the race is a harmless same-version duplicate in the
log, never stale data overwriting fresher data. No buffering or message reordering is
needed.

#### moved_out_tags: filtering stale move-in results

Async move-in queries can return stale data because the world changes while the query
runs. Main handles this with `moved_out_tags`: when a move-out arrives while a move-in
query is in flight, the hash is recorded. When the query results are written, rows
matching the hash are skipped, preventing stale rows from entering the log.

For multi-disjunct shapes, `moved_out_tags` must be **position-aware**. Main tracks
bare hashes, but for `x IN sq1 OR x IN sq2`, both positions produce the same `hash(a)`
for value `a`. If `a` exits sq1, position-unaware filtering would incorrectly skip rows
for sq2 (same hash, different position). Instead, track `{position, hash}` tuples and
filter only at the **triggering position** — the position that caused the move-in query.

This handles all race conditions:

| Scenario | How it's handled |
|----------|-----------------|
| Value enters and exits subquery in same `materializer_changes` batch | `cancel_net_zero_events` in materializer — events cancel out |
| Value enters in one batch, exits in a later batch (same txn) | `moved_out_tags` records hash during `process_move_outs`; stale rows filtered at `query_complete` |
| Value enters in txn T, exits in txn T+1 while query running | Same — `moved_out_tags` records hash from T+1's move-out; T's query results filtered |
| Same hash at different positions (`x IN sq1 OR x IN sq2`) | Position-aware filtering only checks the triggering position |
| Partial exit from multi-value query ([A, B] queried, A exits) | Per-row filtering: row with A skipped, row with B kept |

### Consistency Model for Shapes with Subqueries

Shapes without subqueries provide transactional atomicity: changes from a single Postgres
transaction are delivered together, bounded by up-to-date markers. The client sees a
consistent snapshot after each up-to-date.

**Shapes with subqueries relax this to eventual consistency.** Move-in queries are async
Postgres round-trips that complete after the triggering transaction has been processed.
Because the up-to-date decision (`determine_up_to_date` in `api.ex`) is based purely on
log offsets and has no visibility into pending move-in queries, the client can receive an
up-to-date marker before move-in results have been written to the log.

Concretely, if a single Postgres transaction both modifies the subquery table (causing
move-ins) and modifies the outer table, the client may see:

1. Direct changes to the outer table (from `handle_event`)
2. Up-to-date marker
3. Move-in rows arriving later (from `query_complete`)
4. Another up-to-date marker

This is a pre-existing property of Electric's subquery support (not introduced by this
RFC) and applies equally to single-subquery and multi-subquery shapes.

The key guarantee we **do** maintain: the client will never see rows it shouldn't. The
`moved_out_tags` mechanism ensures that rows which moved out of the shape while a move-in
query was in flight are filtered from the results. The touch_tracker ensures that stale
versions of rows don't overwrite fresher data already in the stream. The system converges
to the correct state — it just may take more than one up-to-date cycle to get there.

### Replication Stream Updates

When the outer shape receives an insert/update/delete from the replication stream:

1. **Compute `active_conditions`** — For each position in the DNF, determine if the condition is satisfied:
   - **Subquery positions**: Check `MapSet.member?(materialized_values, row_value)` using the dependency shape's materializer
   - **Field positions**: Evaluate the simple comparison against the row's data

   This replaces the current `includes_record?` call — we compute per-position results rather than a single boolean.

2. **Derive inclusion** — Evaluate the DNF using `active_conditions`:
   ```
   included = OR over disjuncts, where each disjunct = AND over its non-null positions
   ```
   If not included, skip the row (don't emit to shape log).

3. **Compute tags** — For each disjunct, extract column values at participating positions and hash them (same as current `fill_move_tags`, extended for multiple disjuncts).

4. **Emit message** — Include `tags` and `active_conditions` in the row message:
   ```json
   {
     "key": "...",
     "value": {...},
     "headers": {
       "operation": "update",
       "tags": [["hash1", "hash2", null], [null, null, "hash3"]],
       "active_conditions": [true, true, false],
       "removed_tags": [["hash1", "hash4", null]]
     }
   }
   ```

This is a single pass — no separate `includes_record?` call followed by re-evaluation for `active_conditions`.

For updates, if the row's tag-relevant columns changed, include `removed_tags` for the old values (as today).

### Client Requirements

Clients must:
1. Store tags and `active_conditions` for each row
2. Index rows by `(position, hash_value)` for efficient move-in/move-out handling
3. Evaluate inclusion: OR over tags, where each tag is AND over non-null `active_conditions`
4. Delete rows when no tag evaluates to true after an `active_conditions` update

Tag structure is self-describing — clients learn the DNF shape from the first row's tags.

### Protocol Versioning

Complex WHERE clauses (OR/NOT with subqueries) require protocol version 2. Clients on v1 receive an error for unsupported shapes.

Simple single-subquery shapes continue working on v1.

### `changes_only` Mode

Works the same as today:
- Tags and `active_conditions` included on all operations (insert, update, delete)
- Clients build state incrementally
- Move-in/move-out broadcasts for unknown rows are ignored

### Complexity Check

**Is this the simplest approach?**

The tag-based approach is more complex than shape invalidation, but invalidation provides poor UX for volatile subqueries. This is the minimum complexity needed for correct move-in/move-out without full resync.

**What could we cut?**

- Batched move-in/out messages could be single-value (simpler but more messages)
- Could skip NOT support initially (but De Morgan handling is already in the decomposer)

**What's the 90/10 solution?**

This RFC. The decomposer exists, the tag infrastructure exists, we're extending it to handle the full DNF case rather than single conditions.

## Design Decisions

Questions resolved during RFC development:

| Question | Resolution |
|----------|------------|
| **Maximum disjuncts/positions** | No limit. Document trade-offs (storage, client indexing) and let users discover natural limits. |
| **Tag storage format** | JSON arrays of hash strings, same as current implementation. |
| **Subquery result caching** | Use current approach: subqueries are their own shapes with materializers, multiple outer shapes can reference the same inner shape. |

## Definition of Success

### Primary Hypothesis

> We believe that implementing DNF-based tagging with `active_conditions` will enable shapes with arbitrary boolean WHERE clauses without requiring 409s or shape invalidation.
>
> We'll know we're right if shapes with OR/NOT subqueries handle move-ins without triggering client resync.
>
> We'll know we're wrong if the complexity causes correctness bugs or unacceptable performance overhead.

### Functional Requirements

| Requirement | Acceptance Criteria |
|-------------|---------------------|
| OR with subqueries | `WHERE x IN sq1 OR y IN sq2` handles move-in/out correctly |
| NOT with subqueries | `WHERE x NOT IN sq1` handles move-in/out correctly |
| Mixed conditions | `WHERE (x IN sq1 AND status='active') OR y IN sq2` works |
| Nested NOT | `WHERE NOT (x IN sq1 AND y IN sq2)` decomposes correctly |
| Move-in efficiency | No Postgres query when row already present for another disjunct |
| Move-out correctness | Row removed only when no disjunct evaluates to true |
| Protocol compatibility | V1 clients get error for unsupported shapes |

### Learning Goals

1. What's the performance impact of computing `active_conditions` in snapshot queries?
2. How well does PostgreSQL deduplicate subquery execution between SELECT and WHERE?
3. What's the typical tag/`active_conditions` storage overhead per row?

## Alternatives Considered

### Alternative 1: Shape Invalidation on OR/NOT

**Description:** Continue returning 409 and forcing full resync when subquery conditions change in OR/NOT shapes.

**Why not:** Poor UX for volatile subqueries. Users report frustration with constant resyncs.

### Alternative 2: Server-side Row Tracking

**Description:** Server maintains `{condition_values → row_keys}` index to send targeted updates instead of broadcasts.

**Why not:**
- Significant server memory/disk overhead
- Doesn't scale with large shapes
- Requires persistence and recovery mechanisms

### Alternative 3: Client-side WHERE Evaluation

**Description:** Send WHERE clause AST to client, client evaluates conditions locally.

**Why not:**
- Clients need to implement PostgreSQL function subset
- Exposes potentially sensitive constants in WHERE clause
- Complex client implementation across all platforms

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-27 | rob | Initial version |

---

## RFC Quality Checklist

Before submitting for review, verify:

**Alignment**
- [x] RFC extends existing subquery infrastructure consistently
- [x] Message format extends existing tags field
- [x] Success criteria are testable

**Calibration for Level 1-2 PMF**
- [x] This is the simplest approach that enables the feature
- [x] Non-goals explicitly defer optimizations
- [x] Complexity Check section filled out
- [x] An engineer could start implementing tomorrow

**Completeness**
- [x] Happy path is clear (DNF decomposition → tags → active_conditions → broadcast)
- [x] Critical failure modes addressed (protocol versioning, client evaluation)
- [x] Design decisions documented
