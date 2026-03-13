# Subqueries Algorithm

This document describes the algorithm Electric uses to maintain a consistent shape log when a shape's WHERE clause contains subqueries. The subquery's result set can change at any time (rows move in and out), and the algorithm ensures the shape log remains correct, ordered, and duplicate-free for all consumers.

---

## Table of Contents

1. [Summary](#summary)
2. [Key Concepts & Terminology](#key-concepts--terminology)
3. [System Invariants](#system-invariants)
4. [Visual Explanation](#visual-explanation)
5. [Pseudocode](#pseudocode)
6. [Detailed Case Analysis](#detailed-case-analysis)
7. [Additional Invariants & Edge Cases](#additional-invariants--edge-cases)

---

## Summary

Electric streams a subset of a Postgres table (a "shape") to clients via an append-only operation log. When the shape's WHERE clause contains a subquery (e.g., `WHERE parent_id IN (SELECT id FROM parent WHERE active)`), the set of matching rows can change not just from direct edits to the main table, but also from changes to the *subquery table*. When new values enter the subquery result (a "move-in"), Electric must query Postgres to discover which main-table rows now match. When values leave the subquery result (a "move-out"), those rows must be removed.

The core challenge is that **the move-in query executes asynchronously** against a Postgres snapshot that may be arbitrarily ahead of or behind the consumer's current position in the WAL replication stream. The algorithm must reconcile these two timelines (WAL stream and query snapshot) to produce a single, correctly-ordered log with no duplicates and no missed operations.

The algorithm works by:

1. **Immediately applying move-outs** as control messages (no query needed).
2. **Firing an async query to Postgres** for move-ins, scoped to the new values.
3. **Classifying each WAL operation** during the query's flight as either "covered" (visible to the query snapshot) or "uncovered" (not visible), and deciding whether to append it to the log or delegate authority to the query.
4. **Tracking per-key authority** via two sets: the *shadow set* (WAL is authoritative) and the *delegated set* (query is authoritative).
5. **Splicing query results** into the log at the correct snapshot-ordered position, skipping shadowed keys.
6. **Garbage collecting** transient state once all move-ins have resolved.

---

## Key Concepts & Terminology

| Term | Definition |
|------|-----------|
| **Shape log** | The append-only sequence of INSERT/UPDATE/DELETE operations that clients consume. Must maintain per-key INSERT->UPDATE->DELETE ordering. |
| **Linked value set** | The current set of values from the subquery result. A row in the main table is "in the shape" if its sublink column references a value in this set (and satisfies the rest of the WHERE clause). |
| **Move-in** | A new value enters the linked value set. Requires an async query to Postgres to find matching rows. |
| **Move-out** | A value leaves the linked value set. Applied immediately as a control message (pattern-based tag removal). |
| **Covered** | A WAL operation whose transaction is visible in the move-in query's Postgres snapshot. The query "sees" this operation. |
| **Uncovered** | A WAL operation whose transaction is NOT visible in the query's snapshot. The query does NOT see this operation. |
| **Shadowed** | A key for which the WAL stream is authoritative. The move-in query result for this key will be unconditionally skipped at splice time. Shadowing persists until a DELETE for the key is appended. |
| **Delegated** | A key for which the move-in query is authoritative (a covered operation was skipped). All subsequent covered operations for a delegated key are also skipped. An uncovered operation transitions the key from delegated to shadowed. |
| **Pending move-in** | A move-in whose query is in-flight or whose results haven't been fully filtered and spliced yet. |
| **Splice** | The act of inserting buffered move-in query results into the shape log at the correct position. |
| **Tags** | Per-row metadata derived from the DNF-normalized WHERE clause. Each tag corresponds to a disjunct. Sent as complete sets with activation bitmaps. |
| **Nil snapshot** | Query hasn't obtained a DB connection yet. Treated as "will cover" (not "does not cover") because its eventual snapshot will be after all current operations. |

---

## System Invariants

1. **Per-key ordering**: For any key, the log must follow INSERT -> UPDATE -> DELETE order. No two INSERTs without an intervening DELETE. No UPDATE before INSERT.
2. **No duplicates**: Every row appears at most once unless deleted and re-inserted.
3. **No gaps**: No operation for a key may be skipped unless a newer version will definitely arrive.
4. **Single authority**: At any point during a pending move-in, each key has exactly one authoritative source: either the WAL stream (shadowed or normal) or the move-in query (delegated).
5. **Eventual consistency**: A causally newer operation for a key must appear after all prior operations for that key.

---

## Visual Explanation

### High-Level Flow

```
 Postgres WAL Stream                        Postgres DB (snapshot query)
 ==================                         ==========================
        |                                            ^
        v                                            |
 +--------------+    (2) async query    +-------------------+
 |   Consumer   | -------------------> |  Move-in Query     |
 |              |                      |  WHERE col IN (v1) |
 |  Processing  |    (5) results       |  snapshot @ T=10   |
 |  WAL ops     | <------------------- +-------------------+
 |  one by one  |
 |              |
 |  (3) classify each op:              (4) track per-key authority:
 |    covered vs uncovered               shadow set / delegated set
 |    append vs skip
 |              |
 |  (6) splice results
 |  at snapshot-ordered position
 |              |
 |  (7) GC state when all
 |  move-ins resolved
 +--------------+
        |
        v
    Shape Log (append-only)
    =======================
    [INSERT k1] [INSERT k2] [move-out ctrl] [INSERT k3] ...
                                    ^
                              clients read this
```

### Timeline: Move-In Lifecycle

```
WAL Stream Position (time --->)
=================================

  T=5       T=8       T=10      T=12      T=15      T=18
   |         |         |         |         |         |
   v         v         v         v         v         v
 [txn5]   [txn8]   [txn10]   [txn12]   [txn15]   [txn18]
                      ^                    ^
                      |                    |
               Query snapshot        First txn NOT
               (covers T<=10)        visible in snapshot
                                          |
                                    SPLICE POINT:
                                    insert query results here

  <---- covered by query ---->  <-- uncovered -->

  Operations at T=5,8,10:           Operations at T=15,18:
    - May be skipped if query         - Always appended to log
      will return them (delegate)     - Key marked as shadowed
    - Or appended if not matching
```

### Per-Key Authority Transitions

```
                    +--------+
                    | normal |  (no pending move-in for this key)
                    +--------+
                   /          \
      covered op  /            \  uncovered op
      + WHERE    /              \  (or covered but
        match   /                \  no WHERE match)
               v                  v
        +-----------+       +-----------+
        | delegated |       | shadowed  |
        | (query    |       | (WAL is   |
        |  authority|       |  authority|
        +-----------+       +-----------+
               |                  |
    uncovered  |                  |  DELETE appended
    op arrives |                  |  to log
               v                  v
        +-----------+       +--------+
        | shadowed  |       | normal |
        | (WAL takes|       | (shadow|
        |  back)    |       |  released)
        +-----------+       +--------+
```

### Snapshot-Ordered Splice

```
Buffered move-in results: [{k1, tags1}, {k2, tags2}, {k3, tags3}]
Query snapshot covers: T <= 10

WAL stream as consumer processes it:

  [T=7: INSERT k4]  [T=9: UPDATE k1]  |  [T=12: INSERT k5]  [T=15: ...]
                                       |
               covered by query        |  uncovered (T=12 > snapshot)
                                       |
                                 SPLICE HERE
                                       |
                              For each buffered row:
                                k1: shadowed (T=9 UPDATE was appended) -> SKIP
                                k2: not shadowed -> emit INSERT k2
                                k3: not shadowed -> emit INSERT k3
                                       |
                                       v
Final log:  [..., INSERT k4, UPDATE k1, INSERT k2, INSERT k3, INSERT k5, ...]
```

### Move-Out: Immediate Application

```
WAL: parent row changes value from "active" to "inactive"
     -> value "X" leaves the linked value set

Consumer:
  1. Emit move-out control message:
     { event: "move-out", patterns: [{pos: 0, value: hash("X")}] }

  2. Client removes all rows whose tags match the pattern
     (acts as logical DELETE for all affected keys)

  3. If a pending move-in exists for value "X":
     - Filter its buffered results to remove rows with value "X"
     - Remove "X" from the move-in's tracked values
```

---

## Pseudocode

### Main Processing Loop

```
function process_transaction(txn, state):
    # [P.splice] Check if any buffered move-ins should be spliced before this txn
    ready_to_splice = pop_buffered_move_ins_not_visible_in(txn.xid, state)
    for each (name, key_tag_pairs, snapshot) in ready_to_splice:
        splice_move_in_results(name, key_tag_pairs, state)

    for each change in txn.changes:
        if change affects subquery table:
            handle_subquery_change(change, state)
        else:
            handle_main_table_change(change, txn.xid, state)

    # Remove filtering move-ins that are fully past this txn
    state = remove_completed_filtering_move_ins(txn.xid, state)

    # GC shadow/delegate sets if no move-ins are active
    if no_active_move_ins(state):
        state = clear_shadows_and_delegates(state)
```

### Handling Subquery Table Changes (Move-In/Move-Out Triggers)

```
function handle_subquery_change(change, state):
    old_values = evaluate_subquery_for(change.old_record)
    new_values = evaluate_subquery_for(change.new_record)

    added_values   = new_values - old_values   # values entering linked set
    removed_values = old_values - new_values   # values leaving linked set

    # Move-outs: apply immediately
    for each value in removed_values:
        emit move_out_control_message(value)
        state = filter_pending_move_in_results(value, state)

    # Move-ins: fire async query
    for each value in added_values:
        query = build_move_in_query(shape.where, value)
        state = add_waiting_move_in(name, value, state)
        async execute query -> on_complete(name, results, snapshot)
```

### Handling Main Table Operations During Pending Move-Ins

```
function handle_main_table_change(change, xid, state):
    key = extract_key(change)

    # Skip if moved out
    if is_moved_out(change, state):
        return

    # Already visible in a completed (filtering) move-in? Skip to avoid duplicates
    if change_already_visible_in_filtering_move_in(change, xid, state):
        return

    relevant_move_ins = find_relevant_pending_move_ins(change, state)
    if relevant_move_ins is empty:
        # No pending move-ins affect this change -> normal processing
        append_to_log(change)
        return

    # [P.shadow] If key is already shadowed, always append (WAL is authoritative)
    if is_shadowed(key, state):
        append_to_log(change)
        return

    match change:
        INSERT -> handle_insert(change, xid, key, relevant_move_ins, state)
        DELETE -> handle_delete(change, xid, key, relevant_move_ins, state)
        UPDATE -> handle_update(change, xid, key, relevant_move_ins, state)
```

### INSERT Handling

```
function handle_insert(change, xid, key, relevant_move_ins, state):
    owner = find_owning_move_in(change.record, relevant_move_ins)

    if owner is nil:
        # No move-in claims this row
        append_to_log(change)
        return

    if not move_in_covers_xid(owner, xid):
        # [I.1] Uncovered: append now, shadow for later
        append_to_log(change)
        shadow_key(key, relevant_move_ins, state)
    else:
        if where_clause_matches(change.record):
            # [I.2] Covered + matches: delegate to query
            delegate_key(key, owner, state)
            # Do NOT append — query will return this row
        else:
            # Covered but doesn't match WHERE: append
            append_to_log(change)
```

### DELETE Handling

```
function handle_delete(change, xid, key, relevant_move_ins, state):
    owner = find_owning_move_in(change.record, relevant_move_ins)

    if owner is nil or not move_in_covers_xid(owner, xid):
        # [D.1] Uncovered: append now, shadow for later
        append_to_log(change)
        shadow_key(key, relevant_move_ins, state)
    else:
        # Covered by move-in
        if is_delegated(key, state):
            # [D.2a] Key was delegated (prior INSERT was skipped)
            # Query sees INSERT+DELETE = nothing, returns nothing
            # Skip this DELETE too — both handled by query returning empty
            pass
        else:
            # [D.2b] Key existed before this move-in
            # Append DELETE (it's a real deletion), but don't shadow
            # (row won't be in query results anyway)
            append_to_log(change)
```

### UPDATE Handling (Simplified)

```
function handle_update(change, xid, key, relevant_move_ins, state):
    old_sublink = get_sublink_value(change.old_record)
    new_sublink = get_sublink_value(change.new_record)

    if old_sublink == new_sublink:
        # (a) Sublink unchanged, but row references a moved-in value
        handle_update_no_sublink_change(change, xid, key, relevant_move_ins, state)
    else:
        # (b) Sublink value changed — complex case analysis
        handle_update_with_sublink_change(change, xid, key, old_sublink, new_sublink,
                                          relevant_move_ins, state)

function handle_update_no_sublink_change(change, xid, key, relevant_move_ins, state):
    owner = find_owning_move_in(change.new_record, relevant_move_ins)

    if not move_in_covers_xid(owner, xid):
        # [Ua.1] Uncovered: append + shadow
        append_to_log(change)
        shadow_key(key, relevant_move_ins, state)
    else:
        if where_clause_matches(change.new_record):
            # [Ua.2] Covered + matches: delegate to query
            delegate_key(key, owner, state)
        else:
            append_to_log(change)

function handle_update_with_sublink_change(change, xid, key, old_val, new_val,
                                            relevant_move_ins, state):
    old_in_linked = old_val in linked_value_set
    new_in_linked = new_val in linked_value_set
    old_in_pending = old_val in pending_move_in_values
    new_in_pending = new_val in pending_move_in_values
    owner = find_owning_move_in(change.new_record, relevant_move_ins)
    covered = move_in_covers_xid(owner, xid)

    # [Ub.0] Value was moved out -> skip entirely
    if is_moved_out(change, state):
        return

    # Case: old NOT in linked, new has pending move-in
    if not old_in_linked and new_in_pending:
        convert_to_insert(change)
        if not covered:
            # [Ub.1a] Append + shadow
            append_to_log(change)
            shadow_key(key, relevant_move_ins, state)
        else:
            if where_clause_matches(change.new_record):
                # [Ub.1b] Delegate to query
                delegate_key(key, owner, state)
            else:
                append_to_log(change)

    # Case: old in linked, new has pending move-in
    if old_in_linked and new_in_pending:
        # Keep as UPDATE (row already in shape via old value)
        if not covered:
            # [Ub.2a] Append + shadow
            append_to_log(change)
            shadow_key(key, relevant_move_ins, state)
        else:
            # [Ub.2b] Query would return INSERT for row we already have
            # Append UPDATE now and shadow to prevent duplicate
            append_to_log(change)
            shadow_key(key, relevant_move_ins, state)

    # Case: old is pending move-in value, new in linked set
    if old_in_pending and new_in_linked:
        convert_to_insert(change)
        if not covered:
            # [Ub.3a] Append + shadow
            append_to_log(change)
            shadow_key(key, relevant_move_ins, state)
        else:
            # [Ub.3b] Query won't return this (sublink changed away)
            # Append but don't shadow
            append_to_log(change)

    # Case: old is pending, new NOT in linked set
    if old_in_pending and not new_in_linked:
        if not covered:
            # [Ub.4a] Might be in query results; don't append, just shadow
            shadow_key(key, relevant_move_ins, state)
            add_to_mi_filter_keys(key, owner, state)
        else:
            # [Ub.4b] Won't be in results (sublink changed), skip entirely
            pass

    # Cases [Ub.5] and [Ub.6] handle old_in_pending AND new_in_pending
    # with same or different move-ins — see detailed case analysis below
```

### Move-In Query Completion and Splice

```
function on_move_in_query_complete(name, results, query_snapshot, state):
    key_tag_pairs = extract_key_tag_pairs(results)

    # Buffer for snapshot-ordered splice [P.splice]
    state = buffer_completed_move_in(name, key_tag_pairs, query_snapshot, state)

function splice_move_in_results(name, key_tag_pairs, state):
    # Filter out moved-out rows
    moved_out_tags = get_moved_out_tags(name, state)
    key_tag_pairs = reject_moved_out_rows(key_tag_pairs, moved_out_tags)

    # Filter out mi_filter_keys [Ub.4a]
    filter_keys = get_mi_filter_keys(name, state)
    key_tag_pairs = reject_filter_keys(key_tag_pairs, filter_keys)

    inserted_keys = empty_set()

    for each (key, tags) in key_tag_pairs:
        if is_shadowed(key, state):
            # Key was updated by WAL after query ran -> skip query's stale version
            continue

        if already_in_log(key):
            # Row already present from another source -> skip
            continue

        # Emit as INSERT with complete tag information
        emit INSERT(key, tags)
        inserted_keys.add(key)

    # Transition from waiting to filtering (for duplicate prevention of future WAL ops)
    state = change_to_filtering(name, inserted_keys, state)
```

### Splice Trigger Logic

```
function check_splice_triggers(txn, state):
    # Trigger 1: WAL transaction not visible in query snapshot
    for each buffered_move_in in state.buffered_move_ins:
        if txn.xid NOT visible in buffered_move_in.query_snapshot:
            splice this move-in NOW (before processing this txn)

    # Trigger 2: Global LSN acknowledgement
    if global_last_seen_lsn >= move_in.wal_lsn:
        # Stream has advanced past the query's WAL position
        # All visible transactions have been observed -> safe to splice
        splice this move-in NOW
```

---

## Detailed Case Analysis

This section preserves the full case analysis for reference. Labels like `[I.1]`, `[D.2a]`, `[Ub.3b]` are referenced throughout the codebase.

### INSERTs

| Case | Covered? | WHERE match? | Action | Authority |
|------|----------|-------------|--------|-----------|
| **[I.1]** | No | - | Append to log | Shadow key |
| **[I.2]** | Yes | Yes | Skip (query returns it) | Delegate key |
| **[I.2]** | Yes | No | Append to log | - |

### DELETEs

| Case | Covered? | Delegated? | Action | Authority |
|------|----------|-----------|--------|-----------|
| **[D.1]** | No | - | Append to log | Shadow key |
| **[D.2a]** | Yes | Yes | Skip (query sees INSERT+DELETE=nothing) | - |
| **[D.2b]** | Yes | No | Append to log | - |

### UPDATEs (sublink unchanged)

| Case | Covered? | WHERE match? | Action | Authority |
|------|----------|-------------|--------|-----------|
| **[Ua.1]** | No | - | Append to log | Shadow key |
| **[Ua.2]** | Yes | Yes | Skip (query returns it) | Delegate key |

### UPDATEs (sublink changed)

| Case | Old val | New val | Covered? | Action | Authority |
|------|---------|---------|----------|--------|-----------|
| **[Ub.0]** | moved-out | - | - | Skip | - |
| **[Ub.1a]** | not linked | pending MI | No | Convert to INSERT, append | Shadow |
| **[Ub.1b]** | not linked | pending MI | Yes | Delegate if WHERE matches | Delegate |
| **[Ub.2a]** | linked | pending MI | No | Append as UPDATE | Shadow |
| **[Ub.2b]** | linked | pending MI | Yes | Append as UPDATE | Shadow |
| **[Ub.3a]** | pending MI | linked | No | Convert to INSERT, append | Shadow |
| **[Ub.3b]** | pending MI | linked | Yes | Convert to INSERT, append | - |
| **[Ub.4a]** | pending MI | not linked | No | Don't append | Shadow + filter |
| **[Ub.4b]** | pending MI | not linked | Yes | Skip | - |
| **[Ub.5a]** | pending MI(A) | pending MI(A) | No | Convert to INSERT, append | Shadow |
| **[Ub.5b]** | pending MI(A) | pending MI(A) | Yes | Delegate if WHERE matches | Delegate |
| **[Ub.6a]** | pending MI(A) | pending MI(B) | Both | Delegate if WHERE matches | Delegate |
| **[Ub.6b]** | pending MI(A) | pending MI(B) | Neither | Convert to INSERT, append | Shadow both |
| **[Ub.6c]** | pending MI(A) | pending MI(B) | B only | Delegate B if matches, shadow A | Shadow A |
| **[Ub.6d]** | pending MI(A) | pending MI(B) | A only | Convert to INSERT, append | Shadow both |

---

## Additional Invariants & Edge Cases

### Delegation and Covered INSERT+DELETE Pairs

When a move-in's snapshot covers both an INSERT and a subsequent DELETE for the same key, the query sees the net result (nothing) and won't return the row. Without delegation tracking, the INSERT would be skipped via `[I.2]` but the DELETE would be appended, producing an orphan DELETE with no preceding INSERT. The delegated set prevents this: `[D.2a]` skips the DELETE for a delegated key.

### Nil Snapshots and Coverage

A nil snapshot (query hasn't obtained a connection yet) is treated as "will cover" rather than "does not cover." The query will execute at a future point, so its snapshot will be after all currently-processing operations.

### Linked Value Set and WHERE Clause Evaluation Timing

The linked value set is updated eagerly when a transaction is processed (before evaluating individual changes). Pending move-in values must be **excluded** from the linked set used for WHERE clause evaluation of WAL stream operations to prevent premature emissions and duplicates. They are included for move-in query result evaluation.

### Shadow Set Garbage Collection

When no move-ins are active (no pending queries, no in-flight filtering), the shadow and delegate sets can be safely cleared. Any future move-in will target new values that couldn't have been previously emitted.

### Move-Out Control Messages

Move-outs are pattern-based control messages (tag matching), not per-key DELETEs. They act as logical DELETEs for the INSERT->UPDATE->DELETE ordering invariant. A subsequent INSERT for any affected key is valid because it follows the logical DELETE.

### Cross-Sublink Migration (`[P.cross]`)

A row already in the shape via linked value A may change its sublink to reference value B with a pending move-in. The algorithm appends the stream operation as an UPDATE and shadows the key, ensuring the move-in query's stale version is skipped. Without this, the move-in would produce a duplicate INSERT.

### Snapshot-Ordered Splice (`[P.splice]`)

Move-in query results are buffered and spliced just before the first WAL transaction not visible in the query snapshot. This ensures all earlier-visible operations have been processed, making shadow/delegate decisions consistent. Two splice triggers exist:
1. A WAL transaction arrives that is NOT visible in the query snapshot.
2. Global LSN acknowledgement proves the stream has advanced past the query's position.

### Concurrent Move-Ins for Different Disjuncts

Sequential processing of the replication stream prevents gaps: when the first move-in is processed, the second disjunct's linked values haven't been updated yet, so the first query's NOT clause doesn't exclude the row.

### Move-In -> Move-Out -> Move-In Chains

A move-out invalidates a prior pending move-in by filtering its results. The second move-in starts fresh. Operations between the move-out and second move-in are not propagated (the row is moved out).
