# RFC: Positive DNF Subqueries on Top of the Simple Splice Model

Status: draft

Owner: sync-service prototype

Related:
- `./simple-subqueries.md`
- `./simple-subqueries-filter.md`
- `https://raw.githubusercontent.com/electric-sql/electric/refs/heads/rob/arbitrary-boolean-expressions-with-subqueries/docs/rfcs/arbitrary-boolean-expressions-with-subqueries.md`

## Summary

Extend the current `simple-subqueries.md` model to support multiple positive
subqueries in the same `WHERE` clause, including cases like:

```sql
WHERE x IN subquery1 OR y IN subquery2
```

The core idea is:

- keep the current "subquery views + exact splice point" model for move-ins
- normalize the `WHERE` clause to positive DNF
- plan move-ins per affected DNF disjunct
- populate `active_conditions` properly from DNF positions
- use DNF-shaped row tags plus position-aware move broadcasts
- keep `NOT`-with-subquery on the existing 409-on-move path for now

This is intentionally prototype-first:

- `Shapes.Filter` may continue to oversend
- move buffers stay in memory
- all move work is serialized per shape
- we optimize for consistency and understandable code, not throughput

## Goals

- Support `OR` across direct subqueries.
- Support arbitrary positive boolean expressions over:
  - plain row predicates
  - `value IN (SELECT ...)`
  - row-value `IN (SELECT ...)`
- Populate `active_conditions` correctly for DNF shapes.
- Preserve the current virtual-view and operation-consistency invariants.
- Reuse the existing splice-at-boundary approach from `simple-subqueries.md`.
- Avoid the old `touch_tracker` design.

## Non-goals

- Supporting moves for shapes that combine `NOT` and subqueries
- `EXISTS`, scalar subqueries, `ANY`/`ALL`, or subqueries outside `WHERE`
- Fixing `Shapes.Filter` oversend in this RFC
- Disk-backed buffering, resumability, or recovery
- Parallel move processing within a shape

## Scope

This RFC covers shapes whose `WHERE` clause can be expressed as a positive DNF:

```sql
(term AND term AND ...)
OR
(term AND term AND ...)
OR ...
```

where each `term` is either:

- a normal row predicate, or
- a positive `IN (SELECT ...)` subquery predicate

Shapes that combine `NOT` and subqueries remain on the current unsupported
path: when a subquery move would affect them, they invalidate and clients see a
409/refresh path as they do today.

## Why DNF

The current single-subquery model works because one dependency move can be
turned into one precise "what newly entered?" query:

```sql
x IN moved_in_values AND NOT x IN current_view
```

That stops being sufficient for:

```sql
WHERE x IN subquery1 OR y IN subquery2
```

because a move in `subquery1` should only fetch rows that are newly included by
the `subquery1` side and were not already present via the `subquery2` side.

DNF gives us the right planning unit:

- each disjunct is one independent reason a row can be in the shape
- a move only affects the disjuncts that reference that dependency
- move-in queries can be restricted to those disjuncts
- move broadcasts can flip only the condition positions that actually changed

## Core Model

### 1. Subquery views remain the source of truth

Each shape keeps an in-memory materialized view for each direct subquery:

```elixir
%{
  ["$sublink", "0"] => MapSet.new([...]),
  ["$sublink", "1"] => MapSet.new([...])
}
```

Replication-stream changes are always converted using the full subquery-view map
that is correct for that point in the log.

### 2. The shape keeps one global move queue

We keep the existing "one move at a time" rule, but now it applies across all
direct dependencies for the shape:

- one active move operation per shape
- move-ins and move-outs from all dependencies share the same queue
- move-outs are not processed concurrently with an in-flight move-in

This remains the simplest way to preserve view-timed conversion.

### 3. Move-ins still splice exact query results into the log

We keep the current buffering model:

1. start buffering raw outer-table transactions
2. run a move-in query in a repeatable-read snapshot
3. capture snapshot metadata and `current_lsn`
4. find the splice boundary
5. write:
   1. pre-boundary buffered changes with the old subquery views
   2. move-in query rows
   3. post-boundary buffered changes with the new subquery views

This removes the need for `touch_tracker`: stream/query ordering is now handled
by the splice boundary itself.

### 4. DNF shapes carry tags and `active_conditions`

For single-subquery shapes, the existing tag model is already enough.

For DNF shapes, rows need:

- one tag per disjunct
- one `active_conditions` entry per DNF position

`active_conditions` is already part of the protocol today, but the current
single-disjunct implementation always emits `[true]`. This RFC makes it real:

- row messages carry the actual truth value for each DNF position
- move broadcasts update subquery-backed positions for rows already on the
  client
- clients re-evaluate inclusion from `tags` and `active_conditions`

Move-ins are still handled server-side by query+splice for newly visible rows.
The broadcasts are needed so rows that were already present for one reason can
learn that another reason became true or false.

## DNF Compilation

We can reuse `Electric.Replication.Eval.Decomposer` as the basis, but for this
RFC we only accept decompositions whose literals are all positive.

For a shape we compile and keep:

- `disjuncts`: list of conjunctions
- `subexpressions`: metadata for each DNF position
- `position_count`
- `dependency_positions`: direct dependency handle -> positions
- `dependency_disjuncts`: direct dependency handle -> disjunct indexes

Each position records:

- the base AST
- whether it is a subquery position
- which direct dependency it belongs to, if any
- how to generate SQL for it
- how to generate the `active_conditions` value for it
- how to generate the tag slot for it

Example:

```sql
WHERE (x IN sq1 AND status = 'open')
   OR (y IN sq2)
```

becomes two disjuncts:

- `d0 = [x IN sq1, status = 'open']`
- `d1 = [y IN sq2]`

If `sq1` changes, only `d0` is impacted.

## Move-in Planning

For a move-in on dependency `D` with values `V`:

- `V` is the delta for this move, i.e. the values that were not in `D`'s
  current view and will be present after this move is spliced

1. identify the impacted disjuncts: every disjunct that mentions `D`
2. build the candidate move-in predicate:
   - only the impacted disjuncts
   - positions that belong to `D` are replaced with membership against `V`
   - other subquery positions use the current view map
3. build the exclusion predicate from the disjuncts that could already have
   been true before the move:
   - unaffected disjuncts are included as-is, with subquery positions using the
     current view map
   - impacted disjuncts are omitted from the exclusion predicate when they
     contain a triggering position replaced by `V`, because `V` is disjoint from
     the current view for that position and those old disjunct instances are
     therefore impossible
4. query:

```sql
WHERE (<candidate_move_in_predicate>) AND NOT (<exclusion_predicate>)
```

This gives the rows that become newly visible because of this move, while
excluding rows already present via some other disjunct.

`move_in_values` is therefore not extra state beyond the move itself; it is the
thing that makes the query narrow to "rows newly relevant because of this
delta", rather than querying against the whole post-move view of the
dependency.

Because move-in queries are parameterized only by:

- `move_in_values` for the triggering dependency, and
- the in-memory subquery views for all direct dependencies at the start of the
  move,

the query does not depend on live subqueries while it is in flight. Subsequent
moves are queued, do not overlap, and do not advance the shape's subquery views
until their own splice point.

In addition to the move-in query, the shape emits position-aware `move-in`
broadcasts for the triggering dependency values. These broadcasts are how
clients update `active_conditions` for rows that were already in the shape via
another disjunct and therefore are excluded from the move-in query.

### Example

```sql
WHERE x IN sq1 OR y IN sq2
```

If `sq1` moves in `a`, the move-in query becomes conceptually:

```sql
WHERE x = ANY($moved_in_sq1_values)
  AND NOT (y = ANY($sq2_current_view))
```

If the shape is:

```sql
WHERE (x IN sq1 AND status = 'open') OR y IN sq2
```

then a move in `sq1` becomes:

```sql
WHERE x = ANY($moved_in_sq1_values)
  AND status = 'open'
  AND NOT (y = ANY($sq2_current_view))
```

The `sq1_current_view` branch drops out because `moved_in_sq1_values` is, by
definition, disjoint from `sq1_current_view`.

In practice we should generate this from compiled DNF metadata, not by string
replacement on the original SQL.

## Move-in Runtime

The move-in state machine stays the same structurally, but its state must now
carry a full view map rather than one subquery view:

- `views_before_move`
- `views_after_move`
- `trigger_dependency_handle`
- `trigger_positions`
- `move_in_values`
- buffered transactions
- snapshot metadata
- move-in rows
- move-in LSN
- splice boundary

Steady-state conversion becomes:

```elixir
Shape.convert_change(shape, change,
  stack_id: stack_id,
  shape_handle: shape_handle,
  extra_refs: {views, views}
)
```

During a splice:

- pre-boundary buffered changes use `views_before_move`
- query rows are already computed for the move
- post-boundary buffered changes use `views_after_move`

## Tags And `active_conditions`

Each row message carries:

- `tags`: one tag per disjunct
- `active_conditions`: one boolean per DNF position

`active_conditions[position]` is the truth value of that position for the row
at the time the row message is emitted.

- for normal row predicates, it is computed directly from the row
- for subquery predicates in the initial snapshot, it is computed by SQL on the
  existing snapshot query path
- for replication-stream changes, it is computed against the correct in-memory
  subquery views for that log point
- for move-in query rows, it is computed against `views_after_move`

Each tag has one stable slot per DNF position. A participating position gets a
non-empty segment; a non-participating position gets an empty segment.

For subquery positions, the segment contains the existing hashed value used for
move matching.

For non-subquery positions, the segment is a fixed non-empty sentinel such as
`"1"`. Only emptiness matters for those positions; they are never targeted by
move broadcasts.

Example:

```sql
WHERE (x IN sq1 AND status = 'open') OR (y IN sq2)
```

Possible row metadata:

```json
{
  "tags": ["hash(x)/1/", "//hash(y)"],
  "active_conditions": [true, true, false]
}
```

Here:

- position 0 is `x IN sq1`
- position 1 is `status = 'open'`
- position 2 is `y IN sq2`

If a disjunct has multiple subquery positions, its tag still has one slot per
DNF position, for example:

```sql
WHERE (x IN sq1 AND z IN sq2) OR (y IN sq3)
```

could produce:

```text
["hash(x)/hash(z)/", "//hash(y)"]
```

Clients evaluate inclusion as:

1. for each tag, take the positions with non-empty segments
2. AND the corresponding `active_conditions`
3. OR the per-tag results

This is why `active_conditions` must be correct even for rows that were already
present before a move.

## Move Broadcasts

Move broadcasts are position-aware and operate on the existing tag hashes.

### Move-in broadcast

When values move into dependency `D`, the shape emits `move-in` broadcasts for
the affected DNF positions and values.

Clients use these to set the corresponding `active_conditions[position] = true`
for already-present rows whose tag has a matching value at that position.

The move-in query still runs, but only for rows that are newly visible:

- rows already present via another disjunct are excluded by
  `NOT (<old_full_predicate>)`
- those rows still need the `move-in` broadcast so their
  `active_conditions` become accurate

### Move-out broadcast

When values move out of dependency `D`, the shape emits `move-out` broadcasts
for the affected DNF positions and values.

Clients use these to set `active_conditions[position] = false` for matching
rows and then re-evaluate inclusion.

## Move-out Handling

When values move out of dependency `D`:

1. identify the DNF positions for `D`
2. emit move-out patterns for those positions and values
3. remove those values from the in-memory subquery view after the operation is
   logically applied

If a move-in is already in flight, the move-out stays queued until that move-in
has been spliced. This is the same serialization rule as in
`simple-subqueries.md`, now applied across all direct dependencies of the
shape.

Tags stay on the row; they describe which disjunct positions the row can
participate in. Subquery moves change `active_conditions`, not the tags
themselves.

Rows stay in the shape while at least one tag still evaluates to true against
the current `active_conditions`.

Rows leave the shape when no tag evaluates to true anymore.

This is also why move-ins need broadcasts as well as query rows: `x IN sq1 OR y
IN sq2` must not leave stale `active_conditions` on rows that were already
present when `sq1` becomes true.

## Filter Behaviour

`Shapes.Filter` is allowed to stay conservative.

For this prototype:

- the filter may continue to route all subquery shapes for a table
- reverse-index work is optional optimization, not part of correctness
- while a move-in is buffering, it is acceptable to admit a broad superset of
  root-table changes

Correctness is enforced later by `Shape.convert_change/3` with the appropriate
view map for the change's position relative to the splice boundary, plus
position-aware move broadcasts for client-side `active_conditions`.

## Nested Subqueries

Nested subqueries still work recursively:

- each shape only reasons about its direct subqueries
- upstream shapes materialize the values for downstream shapes
- DNF compilation and move planning happen independently at each level

## Prototype Simplifications

These are intentional for now:

- keep one global move queue per shape
- keep move buffers in memory
- allow filter oversend
- keep `%LsnUpdate{}` broadcast broad if that is easiest
- use the DNF path whenever considering subqueries, including the current
  single-subquery case
- continue to 409/invalidate on moves for shapes that combine `NOT` and
  subqueries

## Suggested Implementation Shape

- `DnfPlan` or similar compiled metadata held alongside the shape, for example
  in consumer state or another per-shape runtime structure
- `SubqueryViews` map keyed by subquery ref
- one `MoveQueue` per shape across all dependencies
- `MovePlanner`:
  - impacted disjunct lookup
  - predicate generation
  - tag generation metadata
  - position-aware move-in and move-out broadcast metadata
- `Buffering`:
  - before/after view maps
  - snapshot and LSN tracking
  - buffered transactions
- `SpliceRow`:
  - replace the assumption that query rows are only inserts if needed later
- `Materializer`:
  - multiple tags per row
  - position-aware move-out matching
- `Shape.convert_change/3` and snapshot query generation:
  - compute real `active_conditions` from DNF positions instead of all-`true`

## Open Decisions To Confirm

None currently.
