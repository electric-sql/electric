# Plan: Negated Subquery Moves

## Goal

Support negated subquery predicates in the DNF runtime, including:

- `x NOT IN (SELECT ...)`
- `NOT (x = 7 OR y IN (SELECT ...))`
- mixed positive/negative DNF shapes where the outer shape should no longer
  fall back to 409-on-move invalidation

The key requirement is that negation must work with the existing move
broadcasts, move-in splice flow, and DNF `active_conditions` model.

## Current State

Most of the DNF work is already in place:

- `Electric.Shapes.DnfPlan` already preserves per-position negation metadata.
- `Shape.convert_change/3` already uses `DnfPlan.project_row/6`, which can
  evaluate negated positions from a concrete subquery view map.
- the materializer already handles position-aware `move-in` / `move-out`
  broadcasts by flipping `active_conditions[pos]`.

The remaining blocker is that the runtime still treats "dependency move
direction" and "outer shape effect" as the same thing. That is true for
positive subqueries, but false for negated ones:

- positive subquery:
  - dependency move-in -> outer move-in
  - dependency move-out -> outer move-out
- negated subquery:
  - dependency move-in -> outer move-out
  - dependency move-out -> outer move-in

That mismatch currently shows up in three places:

- `lib/electric/shapes/consumer.ex`
  - `initialize_subquery_runtime/1` still skips runtime setup for
    `%DnfPlan{has_negated_subquery: true}`
- `lib/electric/shapes/querying.ex`
  - `dnf_plan_for_metadata/2` still suppresses DNF metadata for negated plans
- `lib/electric/shapes/consumer/state.ex`
  - `not_with_subquery?` is still computed even though the DNF runtime should
    own this now

## Design Direction

Keep `views` as the actual dependency view, not the outer shape's
"allowed-values" view.

That matters because:

- `DnfPlan.project_row/6` expects actual dependency results in `extra_refs`
- move-in query rows must be returned with `active_conditions` computed against
  the actual post-move dependency view
- streamed transactions before/after the splice boundary must keep using the
  real before/after dependency views

So the runtime needs two separate concepts:

1. dependency delta
   - did the dependency view add a value or remove a value?
2. outer effect
   - does that delta make outer rows move in or move out?

For positive subqueries those are aligned. For negated subqueries they invert.

## Work Plan

### 1. Remove the Negation Guards

Delete the remaining "negation means unsupported" branches:

- remove `State.not_with_subquery?` and `has_not_with_subquery?/1`
- stop treating `%DnfPlan{has_negated_subquery: true}` as a reason to leave
  `subquery_state` unset in `lib/electric/shapes/consumer.ex`
- stop rejecting negated DNF plans in `lib/electric/shapes/querying.ex`

At that point, negated shapes will enter the same runtime as positive ones.

`Shape.convert_change/3` should not need special negation work beyond this,
because it already goes through `DnfPlan.project_row/6`.

### 2. Teach `DnfPlan` About Dependency Polarity

The runtime needs dependency-level polarity metadata, not just a boolean
`has_negated_subquery`.

Add plan helpers such as:

- dependency polarity per dependency index
- `effect_for_dependency_delta(plan, dep_index, :view_add | :view_remove)`
  returning `:move_in | :move_out`

Also add an explicit validation or test that all positions for one dependency
share the same negation semantics. That should hold today because one
dependency handle represents one subquery occurrence, but it is worth pinning
down. If it does not hold, the mapping has to become position-based rather
than dependency-based.

`has_negated_subquery` can then either be removed or kept as informational
metadata only. It should stop driving runtime feature gating.

### 3. Split Queue Semantics Into View Delta vs Outer Effect

This is the main consumer change.

Today `MoveQueue`, `Subqueries.drain_queue/2`, and `Buffering.from_steady/5`
all assume:

- `move_in` means "add values to the dependency view and run a move-in query"
- `move_out` means "remove values from the dependency view and emit a move-out broadcast"

That only works for positive subqueries.

Refactor the queue/runtime state to track actual dependency deltas explicitly,
for example:

- `:view_add`
- `:view_remove`

Then derive the outer effect from plan polarity when draining:

- positive dep:
  - `:view_add` -> outer `move-in`
  - `:view_remove` -> outer `move-out`
- negated dep:
  - `:view_add` -> outer `move-out`
  - `:view_remove` -> outer `move-in`

Important detail: redundancy elimination in `MoveQueue` should keep operating
against the actual dependency view, not the outer effect. Otherwise a negated
dependency move-out would be incorrectly treated as a redundant `move-in`
because the value is still present in the pre-move dependency view.

### 4. Generalize Buffering State for Negated Move-Ins

Buffering currently assumes "outer move-in" implies "dependency view add".

That needs to change. Store the trigger as actual delta metadata, not as
`move_in_values` alone, for example:

- trigger dependency index
- trigger delta kind (`:view_add` or `:view_remove`)
- trigger delta values
- `views_before_move`
- `views_after_move`

For negated subqueries:

- dependency `view_add` should become an immediate outer `move-out`
  - update `views` by adding the value
  - emit a `move-out` broadcast
  - no query
- dependency `view_remove` should become a buffered outer `move-in`
  - `views_before_move` contains the value
  - `views_after_move` removes the value
  - the move-in query and post-splice changes use `views_after_move`

This is the place where we "convert move-ins to move-outs and vice versa" in
the consumer, but without losing track of the real dependency-view transition.

### 5. Make Move-In Query Generation Delta-Aware

`DnfPlan.move_in_where_clause/5` is still positive-subquery-shaped.

For negated outer move-ins, the trigger comes from a dependency removal, and
the candidate rows are those matching the removed values, not rows satisfying
`NOT membership` over the removed-value set.

So the move query builder should accept:

- dependency index
- actual delta kind
- delta values
- `views_before_move`
- `views_after_move` if needed for active-condition SQL

The trigger-position rule should be:

- when a dependency delta causes an outer move-in, the trigger position is
  replaced by membership against the delta values themselves
- the negated/non-negated meaning is still applied when computing
  `active_conditions` for the returned rows against the post-move view

Concretely:

- positive subquery + dependency add:
  - candidate uses `x IN moved_in_values`
- negated subquery + dependency remove:
  - candidate also uses `x IN removed_values`

The difference is not in candidate matching; it is in which dependency delta
produces an outer move-in, and in which post-move view is used for the
returned metadata.

### 6. Keep Broadcast Semantics, but Emit the Right One

The materializer already knows how to interpret:

- `move-in` as `active_conditions[pos] = true`
- `move-out` as `active_conditions[pos] = false`

That means negation support should mostly be achieved by making the consumer
emit the correct broadcast for the outer effect:

- negated dependency add -> emit outer `move-out`
- negated dependency remove -> emit outer `move-in`

No new negation-specific materializer protocol is needed.

What does need verification:

- rows that leave the shape on a negated `move-out` can still be reintroduced
  later by a negated `move-in` query
- rows that remain included via another disjunct only get their
  `active_conditions` flipped, not spuriously deleted

### 7. Initial Snapshot Metadata Must Use DNF for Negated Shapes

Once the query-side guard is removed, initial snapshot queries for negated
subquery shapes should emit:

- real `tags`
- real `active_conditions`

using the same DNF metadata path as positive shapes.

Without that, later move broadcasts cannot update already-present rows
correctly.

The existing `DnfPlan.active_conditions_sql/1` and `tags_sql/3` look close to
what we need already; the main change is to let negated plans reach that path
and add tests around the emitted metadata.

## Tests To Add Or Rewrite

### Unit

- `test/electric/shapes/dnf_plan_test.exs`
  - dependency polarity metadata
  - negated plan no longer treated as unsupported
  - move-query SQL for `NOT IN`
  - move-query SQL for `NOT (x = 7 OR y IN subquery)`

- `test/electric/shapes/querying_test.exs`
  - initial snapshot metadata for negated shapes includes correct `tags` and
    `active_conditions`

- `test/electric/shapes/consumer/subqueries/move_queue_test.exs`
  - queue reduction remains based on actual dependency view deltas
  - negated dependency remove survives as an outer move-in
  - negated dependency add survives as an outer move-out

- `test/electric/shapes/consumer/subqueries_test.exs`
  - negated dependency add updates the view immediately and emits move-out
  - negated dependency remove buffers, splices, and emits move-in
  - pre/post-boundary txn conversion uses the correct before/after actual views

- `test/electric/shapes/consumer/materializer_test.exs`
  - negated move-out deletes only when the row loses its last active reason
  - negated move-in can re-activate an already present row via broadcast

### Integration

- replace the current 409 expectation in
  `test/electric/plug/router_test.exs` for `NOT IN` with real move semantics
- add router/integration coverage for:
  - `parent_id NOT IN (SELECT id FROM parent WHERE excluded = true)`
  - `NOT (value = 7 OR parent_id IN (SELECT ...))`
  - a mixed DNF case where one disjunct is negated and another positive

### Oracle / Property

The oracle harness already generates `NOT IN` cases, but currently marks them
as unoptimized. Once the runtime lands, update
`test/support/oracle_harness/where_clause_generator.ex` so supported negated
subquery shapes participate in optimized-vs-oracle comparisons.

## Recommended Landing Order

1. remove `not_with_subquery?` and the runtime/query gating
2. add dependency polarity metadata to `DnfPlan`
3. refactor `MoveQueue` / `Subqueries` / `Buffering` to track actual view deltas
4. generalize move-in query generation to use delta-aware trigger semantics
5. enable initial snapshot DNF metadata for negated shapes
6. replace 409 tests with semantic integration coverage
7. widen oracle/property coverage

## Non-Goals

- no new invalidation path
- no filter/event-router redesign
- no change to the client protocol beyond using the existing `move-in` /
  `move-out` events correctly

The existing materializer protocol should be sufficient if the consumer emits
the right event name and keeps the actual dependency views consistent across the
splice.
