# RFC: Shared Subquery Indexes with Logical-Time Views

Status: Draft

Scope: `packages/sync-service`

## Summary

Electric v1.6 introduced per-shape subquery indexing so boolean subquery
shapes stay live while dependency rows move across `WHERE` boundaries. That
solved correctness, but it made memory scale with the number of outer shape
consumers.

This RFC proposes replacing per-consumer materialized subquery views with one
shared, versioned view per subquery. Consumers do not copy the subquery view.
Instead, each consumer keeps the logical time it is reading and asks the shared
view for membership at that time.

The design keeps current move-in/move-out correctness for positive, negated,
`AND`, `OR`, and `NOT` subquery expressions, while reducing duplicate memory in
the filter index and in consumer event handlers.

## Background

The current implementation stores subquery state in two duplicated places:

- `Electric.Shapes.Filter.Indexes.SubqueryIndex` stores per-shape routing and
  exact membership rows.
- `Electric.Shapes.Consumer.EventHandler.Subqueries` stores per-consumer
  `MapSet` views, including both before and after views while a move-in is
  buffering.

The key correctness problem is that consumers can temporarily disagree about a
subquery's membership. One consumer may have processed a dependency move while
another has not. The current implementation handles that by letting each outer
shape seed and update its own exact view.

This is correct, but it duplicates the same dependency view across many
consumers.

## Problem

For a popular subquery, memory currently scales roughly with:

```text
number_of_outer_consumers * number_of_values_in_subquery
```

There are two major pools of duplicated memory:

1. Subquery routing and exact membership rows keyed by outer shape.
2. Consumer-held dependency views, including before and after views during
   active move-in buffering.

A reverse index such as `shape_handle -> all values` would make removal faster,
but it would add another per-consumer value list and worsen the memory problem.

## Goals

- Store one shared materialized view per subquery.
- Allow consumers to read exact membership at separate logical times.
- Keep routing conservative enough while consumers are at different logical
  times.
- Keep subquery addition and removal proportional to the subquery and group
  data being changed, not to the total number of shapes in the stack.
- Preserve correctness for positive subqueries, negated subqueries, `AND`,
  `OR`, and `NOT`.
- Avoid changing the client wire protocol.

## Non-Goals

- This RFC does not change Electric's HTTP protocol.
- This RFC does not change the semantics of supported subqueries.
- This RFC does not attempt to make negated-subquery routing better than
  `O(number_of_affected_shapes)`. If a value is absent from a large negated
  subquery group, all of those shapes are genuinely affected.

## Definitions

### Subquery

A subquery is represented by its dependency shape. The `subquery_id` is the
handle of that dependency shape.

Different `SELECT` statements are different subqueries, even if they differ
only by constants. For example:

```sql
SELECT id FROM users WHERE company_id = 7
SELECT id FROM users WHERE company_id = 8
```

These are two different subqueries and get two different `subquery_id` values.

### Subquery Group

A subquery group is a set of subquery occurrences with the same:

- filter tree node
- field key
- polarity

For example, these two outer shapes use different subqueries, but the same
subquery group if the subquery occurrence appears at the same filter node:

```sql
WHERE user_id IN (SELECT id FROM users WHERE company_id = 7)
WHERE user_id IN (SELECT id FROM users WHERE company_id = 8)
```

The subqueries differ by `company_id`, but the group is the same because the
field key is `user_id` and the polarity is positive.

A single `subquery_id` can appear in multiple groups if it appears at multiple
nodes in outer filter trees.

### Child Node

A `child_node_id` is created per `{subquery_group_id, subquery_id}` pair.

The child node owns a child `WhereCondition` that contains all outer shapes
using that subquery in that group. This means many outer shapes can share one
child node.

### Logical Time

Logical time is a monotonically increasing integer per subquery.

Time `0` represents the materializer's initial view. Each committed dependency
move that changes subquery membership increments the logical time and records
the move at the new time.

Logical time should use normal BEAM integers. Wrapping is unnecessary and would
make comparison and compaction harder to reason about.

### Processed-Up-To Time

Consumers call:

```elixir
SubqueryProgressMonitor.notify_processed_up_to(time, subquery_id)
```

after they no longer need to read the subquery at `time` or earlier.

For a move from logical time `a` to logical time `b`, once the consumer has
finished processing that move and is steady at `b`, it notifies that it has
processed up to `a`.

The minimum required time for compaction is therefore:

```text
min_processed_up_to_for_live_consumers + 1
```

Consumers registered at current time `t` start with `processed_up_to = t - 1`,
because they need to read time `t`.

## Proposal

### MultiTimeView

`SubqueryIndex.MultiTimeView` stores one shared materialized view per subquery.

It is an ETS-backed structure, with one ETS table per stack. The main logical
key is:

```text
{subquery_id, value} -> membership_history
```

Absence means the value is not a member at any retained logical time.

The common case is a value that is always present for the retained window. That
should be represented compactly, for example:

```elixir
true
```

Values that have moved use a small transition history. The exact structure
should be benchmarked before implementation. A simple starting point is:

```elixir
{:out, [9]}
{:out, [9, 11]}
{:in, [9]}
{:in, [9, 11]}
```

The first atom is the membership state before the first transition. Each time in
the list toggles membership from that time onwards.

Examples:

```elixir
# Out before 9, in from 9 onwards.
{:out, [9]}

# Out before 9, in from 9 to 10, out from 11 onwards.
{:out, [9, 11]}

# In before 9, out from 9 to 10, in from 11 onwards.
{:in, [9, 11]}
```

The API should support:

```elixir
member?(subquery_id, value, time)
member_at_some_time?(subquery_id, value)
member_at_all_times?(subquery_id, value)
values(subquery_id)
values(subquery_id, time)
mark_ready(subquery_id)
ready?(subquery_id)
set_min_required_time(subquery_id, time)
remove_subquery(subquery_id)
```

`member_at_some_time?/2` and `member_at_all_times?/2` operate over the retained
time window for that subquery.

#### Compaction

The `SubqueryProgressMonitor` provides the minimum required logical time for
each subquery. `MultiTimeView` can compact entries by removing transitions
before that time.

Compaction must preserve membership at all retained times. For example:

```elixir
{:out, [9, 11]}
```

If `min_required_time = 10`, membership at time `10` is `true`, and the compacted
history becomes:

```elixir
{:in, [11]}
```

If `min_required_time = 12`, the value is out for the whole retained window, so
the row can be deleted.

Compaction should run:

- when a value is read
- when a value is written
- in a periodic asynchronous compaction pass
- when the progress monitor advances the minimum required time

`remove_subquery/1` must not scan the whole ETS table. The table should be an
ordered set with keys ordered by `subquery_id`, so removal can iterate the
contiguous key range for one subquery.

### SubqueryIndex

`SubqueryIndex` becomes responsible for topology and routing, while
`MultiTimeView` owns exact membership.

The index stores compact integer identifiers for repeated values:

```text
{node_id, field_key, polarity} -> subquery_group_id
subquery_group_id -> {node_id, field_key, polarity}

{subquery_group_id, subquery_id} -> child_node_id
child_node_id -> {subquery_group_id, subquery_id, next_condition_id}
subquery_id -> [{subquery_group_id, child_node_id}]
```

Using small integer ids avoids repeating large tuples, field keys, and shape
handles in per-value ETS rows.

For positive groups, the routing index stores values that can be members at
some retained logical time:

```text
{positive_value, subquery_group_id, value} -> [child_node_id]
```

For negative groups, the index stores all negative children for the group:

```text
{negative_children, subquery_group_id} -> [child_node_id]
```

The negative path cannot avoid considering all affected children when a value
is absent from the subquery views. That is acceptable because those children are
affected.

#### Affected Shapes

For a root-table change, `SubqueryIndex.affected_shapes/4` evaluates the
left-hand side value for the subquery node.

If evaluation fails, it falls back to all children in the group.

If a subquery is not ready, the child node is routed conservatively.

For a positive group:

```elixir
for child_node_id <- positive_children_for_value(group_id, value),
    subquery_id = subquery_id_for_child(child_node_id),
    MultiTimeView.member_at_some_time?(subquery_id, value) do
  WhereCondition.affected_shapes(child_node_id, record)
end
```

For a negative group:

```elixir
for child_node_id <- all_negative_children(group_id),
    subquery_id = subquery_id_for_child(child_node_id),
    not MultiTimeView.member_at_all_times?(subquery_id, value) do
  WhereCondition.affected_shapes(child_node_id, record)
end
```

This keeps routing broad enough for all consumers reading any retained logical
time.

#### Shape Addition

Adding an outer shape to an existing `{group, subquery_id}` child is near O(1):
the shape is added to the child `WhereCondition`.

Creating the first child for `{group, subquery_id}` requires indexing current
values for that subquery in the group. That is O(number of values in the
subquery), which is acceptable and unavoidable unless the child stays in a
fallback mode until asynchronous seeding completes.

#### Shape Removal

Removing an outer shape removes it from the child `WhereCondition`.

If the child becomes empty, remove the `{group, subquery_id}` child and update
the group value indexes by iterating the values for `subquery_id` from
`MultiTimeView`. This is proportional to the number of values in that subquery,
not to the total number of shapes or subqueries.

### Materializer

The materializer continues to track dependency shape membership from the
dependency log.

It changes in three ways:

1. On initial load, it populates `MultiTimeView` for the subquery at logical
   time `0`, then marks the subquery ready.
2. On each committed batch that produces net move events, it increments the
   subquery logical time.
3. Before sending `{:materializer_changes, ...}` to subscribers, it writes the
   move events to `MultiTimeView` at the new logical time.

The subscriber payload should include both the old and new logical time:

```elixir
%{
  move_in: [{value, original_string}],
  move_out: [{value, original_string}],
  txids: [txid],
  from_time: old_time,
  to_time: new_time
}
```

If a committed batch has no net membership move, logical time does not need to
advance.

The existing `Materializer.LinkValues` ETS cache should be removed or replaced
by `MultiTimeView` rather than kept as a second full shared copy.

### Consumer Event Handlers

Consumers store logical times instead of materialized subquery views.

The steady handler keeps:

```elixir
%{subquery_ref => logical_time}
```

`Shape.convert_change/3` and DNF metadata projection need to accept a membership
callback instead of requiring a concrete `MapSet` view:

```elixir
fn subquery_ref, value, time ->
  MultiTimeView.member?(subquery_id, value, time)
end
```

In steady state, old and new records use the same logical time.

During a buffered move-in, `ActiveMove` stores:

```elixir
times_before_move
times_after_move
```

instead of:

```elixir
views_before_move
views_after_move
```

Buffered transactions before the splice boundary are converted using
`times_before_move`. Buffered transactions after the splice boundary are
converted using `times_after_move`.

After the move is spliced and the consumer becomes steady at `to_time`, it
calls:

```elixir
SubqueryProgressMonitor.notify_processed_up_to(from_time, subquery_id)
```

#### Move-In Queries

Move-in queries currently build SQL from whole before and after views. The new
implementation should avoid retaining large views in the consumer process.

Preferred approach:

- Build the triggering dependency candidate predicate from the move delta
  values when possible.
- Read full view values at a specific time only for positions that require
  exclusion logic.
- If full views are required, materialize them inside the task process that
  runs the query so the memory is released when the task exits.

This is important because replacing long-lived consumer views with
short-lived task views is where much of the memory win comes from.

### SubqueryProgressMonitor

`SubqueryProgressMonitor` tracks the earliest logical time still needed by live
outer consumers.

Consumers register for each subquery they read. Registration at current time
`t` inserts:

```text
processed_up_to = t - 1
```

When a consumer finishes a move from `from_time` to `to_time`, it calls:

```elixir
SubqueryProgressMonitor.notify_processed_up_to(from_time, subquery_id)
```

The monitor maintains two ETS indexes:

```text
{subquery_id, consumer_shape_handle} -> processed_up_to
{subquery_id, processed_up_to, consumer_shape_handle} -> true
```

The first index makes updates O(1). The second index makes the minimum
processed time for a subquery cheap to read.

When the minimum changes, the monitor notifies `MultiTimeView`:

```elixir
MultiTimeView.set_min_required_time(subquery_id, min_processed_up_to + 1)
```

When an outer shape is removed, the monitor removes that consumer from every
subquery it was registered for and recomputes the affected minima.

### Concurrency Model

Most writes are already serialized by existing processes:

- Shape addition and removal happen through the ShapeLogCollector path.
- Dependency changes are applied by materializers.
- Outer consumers process events synchronously when ShapeLogCollector publishes
  to them.

`MultiTimeView` writes happen in the materializer before it sends
`materializer_changes` to subscribers.

`SubqueryIndex` topology changes happen when shapes are added or removed from
the filter.

`SubqueryIndex` reads happen from ShapeLogCollector while routing replication
changes.

Consumer reads from `MultiTimeView` can happen concurrently with writes. This
is safe because membership is always read at an explicit logical time, and ETS
updates replace complete membership-history values atomically.

The ready flag is important. Until a subquery has been seeded into
`MultiTimeView` and any group routing rows have been created, routing must be
conservative.

## Expected Benefits

- One retained membership view per subquery instead of one per outer shape.
- Consumer processes retain logical times instead of large `MapSet` views.
- Move-in buffering retains before/after logical times instead of before/after
  `MapSet` views.
- Subquery removal is proportional to the removed subquery's values and group
  entries, not to total stack size.
- Positive routing remains value-keyed and efficient.

## Risks

### Off-by-One Compaction

The biggest correctness risk is compacting away a logical time that some
consumer still needs.

The invariant is:

```text
MultiTimeView may compact only times < min_required_time
min_required_time = min(processed_up_to_by_live_consumer) + 1
```

Tests should cover move-in, move-out, repeated toggles, consumer registration,
consumer removal, and compaction across all of those cases.

### Negated Routing Cost

For negated subquery groups, a value absent from all subqueries affects all
children in the group. This can be large, but it is proportional to the number
of affected shapes.

The implementation should avoid extra memory-heavy complement indexes unless
there is evidence they are necessary.

### Move-In Query Memory

If move-in query generation materializes full before and after views in the
consumer process, the design will keep a major source of memory duplication.

Full view materialization should be avoided where possible and isolated to
short-lived task processes where not possible.

### Fallback Windows

Unready subqueries and not-yet-seeded group routing must route conservatively.
This may temporarily over-route, but must not under-route.

## Testing Plan

Add focused unit tests for `MultiTimeView`:

- membership at exact logical times
- `member_at_some_time?/2`
- `member_at_all_times?/2`
- move-in and move-out transitions
- repeated toggles
- compaction after `set_min_required_time/2`
- subquery removal by ordered key range

Add focused unit tests for `SubqueryProgressMonitor`:

- registration at current time
- `notify_processed_up_to/2`
- minimum required time updates
- consumer removal
- multiple consumers at different times

Add `SubqueryIndex` tests:

- positive group routing
- negative group routing
- shared child nodes per `{group, subquery_id}`
- conservative routing for unready subqueries
- child removal after the last outer shape is removed
- no full-table scan on subquery removal

Update consumer event-handler tests:

- steady conversion using logical times
- buffered move-in using before and after logical times
- queued moves across multiple logical times
- progress notifications after splice
- negated move-in and move-out behavior

Keep or extend integration tests for:

- dependency move-in
- dependency move-out
- nested subqueries
- subqueries combined with non-subquery predicates
- rows moving between two dependency values in one transaction

## Open Questions

- Should `MultiTimeView` expose `values(subquery_id, time)` as a materialized
  `MapSet`, a stream, or both?
- Should `SubqueryProgressMonitor.notify_processed_up_to/2` infer the consumer
  identity from process state, or should callers pass the outer shape handle
  explicitly?
- Should first-time child creation seed synchronously, or should it use fallback
  routing while an asynchronous seeding task populates group value rows?
- Which transition-history representation is smallest in practice for ETS:
  list, tuple, or binary?
