# Simplified Subquery Algorithm (Review Draft)

## Decision Summary

This proposal is intentionally conservative:

- Keep current row/tag semantics where possible.
- Replace subquery re-evaluation during streaming with in-memory subquery views.
- Serialize moves per shape with a single queue.
- Prioritize correctness and debuggability over throughput in v1.

## Why Change

The current model has hard edge cases around subquery timing, ordering, and log correctness.

The new model reduces global coordination by making each shape manage its own subquery-view timeline, with explicit transition points.

## Core Model

Treat each subquery as a runtime input, not as something continuously re-executed in SQL during replication processing.

Conceptually:

```sql
WHERE x IN (SELECT id FROM projects WHERE active = true)
```

becomes:

```sql
WHERE x = ANY($subquery_view)
```

where `$subquery_view` is an in-memory materialized set maintained by the shape runtime.

## Terms

- **Subquery view**: In-memory materialization of one direct subquery result set.
- **Virtual view**: The row set clients should have after applying shape-log entries up to a point.
- **Move-in**: Values added to a subquery view.
- **Move-out**: Values removed from a subquery view.
- **Shape log**: Ordered stream of row changes and control messages.

## Correctness Invariants

### 1) Virtual View Consistency (VVC)

At any log position, the virtual view must equal a database snapshot at the same logical point, using subquery views substituted into the shape predicate.

### 2) Operation Consistency

- No `insert` for rows already in virtual view.
- No `update` for rows not in virtual view.
- No `delete` for rows not in virtual view.

Enforcement point: `Shape.convert_change/3` with the subquery view that is correct for the change time.

## Normative Rules

- A shape must process at most one active move operation at a time.
- A shape must use one shared move queue (not per-subquery queues).
- Each changed value must enqueue its own move operation (no batching).
- Move-out operations must be prioritized ahead of move-in operations when queued.
- While move-in is in flight, raw replication changes must be buffered and not immediately converted.
- Subquery view must not advance for move-in until splice commit.
- Move-out must be deferred until buffered pre-splice data is flushed.
- On buffer/resource breach during move-in, the shape is dropped (lose shape) in v1.

## Algorithm

## A) Steady state (no move in flight)

1. Replication change arrives.
2. Convert via `Shape.convert_change/3` using current subquery views (`extra_refs`).
3. Append converted output to shape log.

## B) Move-in

Inputs:

- `moved_in_values`: newly added values
- `current_view`: subquery view before move-in

Steps:

1. **Prepare superset filtering for buffering**
   - Ensure buffering does not drop potentially relevant rows.
   - v1 may use broad filtering for safety.
2. **Start raw buffering**
   - Buffer raw replication changes with metadata sufficient to locate a splice boundary.
3. **Run move-in query**
   - Include moved-in values, exclude rows already represented by `current_view`.
   - Conceptual predicate:

```sql
WHERE <base_non_subquery_conditions>
  AND x = ANY($moved_in_values)
  AND NOT x = ANY($current_view)
```

4. **Locate splice boundary**
   - Use returned snapshot metadata (`xmin`, `xmax`, `xip_list`) to split buffered stream.
5. **Emit in order**
   - Pre-boundary buffered changes converted with old view (`current_view`).
   - Move-in query rows (same log format as current implementation).
   - Post-boundary buffered changes converted with new view (`current_view ∪ moved_in_values`).
6. **Commit view transition**
   - Advance subquery view to include `moved_in_values`.
   - Resume immediate conversion/log append.

## C) Move-out

If no move-in is in flight:

1. Emit move-out control message (same tag-hash scheme as current implementation).
2. Remove moved-out values from subquery view.

If move-in is in flight:

1. Queue move-out.
2. Process after move-in splice completes and buffered pre-splice data is flushed.

## Compatibility Decisions

- Move-in splice row format: same as current implementation.
- Composite-key behavior and predicate semantics: same as current implementation.
- Move-out tag hashing: same as current implementation.

## Nested Subqueries

Apply recursively through dependency chain:

- Each shape reasons only about direct subquery views.
- Upstream shape output materializes downstream subquery views.
- Each shape independently follows this queue + splice model.

## Scope

### In scope (v1)

- Correctness-first single-shape queue model.
- Buffered move-in splice flow.
- Explicit subquery-view transitions.

### Out of scope (v1)

- Bounded buffering/spill strategy.
- Parallel moves within a shape.
- Aggressive filter minimization during move-in.
- Resumable recovery after buffer breach.

## Suggested Implementation Boundaries

- `SubqueryView`: view state and transitions.
- `MoveQueue`: serialization and prioritization.
- `MoveInBuffer`: raw buffering + boundary split.
- `MoveInPlanner`: predicate/parameter construction.
- `MoveSplicer`: ordered emission of pre/move-in/post segments.
- `TagContext`: view-timed tag inputs.

(Names are placeholders; boundaries are the important part.)

## Observability (minimum)

- Move queue depth per shape.
- Move-in latency.
- Buffered change count/bytes.
- Pre/post splice segment sizes.
- Move failures and shape drops.

## Remaining Open Question

1. None currently. The algorithm decisions above are intentional for v1.
