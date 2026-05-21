---
title: Shared Subquery Indexes with Logical-Time Views
version: "0.2"
status: draft
owner: robacourt
contributors: []
created: 2026-05-18
last_updated: 2026-05-18
prd: "N/A - based on https://github.com/electric-sql/electric/issues/4279"
prd_version: "N/A"
---

# Shared Subquery Indexes with Logical-Time Views

## Summary

Electric v1.6 added per-shape subquery indexing so shapes with boolean subquery
filters can stay live while dependency rows move across `WHERE` boundaries.
That solved correctness, but it stores the same dependency view repeatedly in
the filter index and in consumer event handlers. This RFC proposes one shared,
logical-time view per subquery. Consumers register the subqueries they read,
keep only the logical time they are reading, and call
`SubqueryProgressMonitor.notify_processed_up_to(time, subquery_id)` when they no
longer need older times. The filter index routes conservatively across retained
times and verifies exact membership by asking the shared view at the consumer's
logical time.

## Background

Issue: https://github.com/electric-sql/electric/issues/4279

Related work:

- PR #4051 introduced the v1.6 subquery move correctness work:
  https://github.com/electric-sql/electric/pull/4051
- PR #4280 proposed a narrower SubqueryIndex memory design using shared base
  views with sparse XOR exceptions:
  https://github.com/electric-sql/electric/pull/4280
- Current `SubqueryIndex`:
  `packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex`
- Current consumer view setup:
  `packages/sync-service/lib/electric/shapes/consumer/event_handler_builder.ex`
- Current move buffering:
  `packages/sync-service/lib/electric/shapes/consumer/subqueries/active_move.ex`
- Current SQL move-in query construction:
  `packages/sync-service/lib/electric/shapes/querying.ex`

The v1.6 subquery work allowed shapes with boolean combinations around
subqueries to stay live when dependency rows move. Without that, Electric would
invalidate the outer shape and require a full resync.

The current implementation achieves correctness by letting each consumer own a
local dependency view. `EventHandlerBuilder` reads each dependency
materializer's values into a per-consumer `MapSet`. During an active move,
`ActiveMove` stores `views_before_move` and `views_after_move`. Separately,
`SubqueryIndex` stores per-shape routing rows and exact membership rows keyed
by `shape_handle`, `subquery_ref`, and value.

That model is correct because consumers can temporarily disagree about the same
subquery. One consumer may have processed a dependency move while another has
not. The current implementation represents that by copying the dependency view
per consumer.

## Problem

For a popular subquery, memory currently scales roughly with:

```text
number_of_outer_consumers * number_of_values_in_subquery
```

There are two large duplicated pools:

- `SubqueryIndex` stores value membership and routing rows per outer shape.
- Consumer event handlers store dependency views per outer shape, and store
  both before and after views while a move-in is active.

Shape removal is also expensive because current value-keyed membership rows do
not have a cheap reverse path from a shape to all of the rows it owns. Adding a
reverse index such as `shape_handle -> all values` would improve removal, but
it would add another copy of the full per-shape dependency view.

The wider design problem is that the current system optimizes for the
exceptional case, where every consumer has a distinct subquery view, by paying
that memory cost in the common case where many consumers share the same view
and only diverge briefly during moves.

**Link to PRD hypothesis:** There is no PRD for this RFC. The working
hypothesis comes from issue #4279:

> Redesigning the SubqueryIndex so it does not store full per-shape dependency
> views will make shape add/remove scalable and reduce memory consumption,
> while preserving v1.6 subquery move correctness.

## Goals & Non-Goals

### Goals

- Store one shared materialized view per subquery.
- Allow consumers to read exact subquery membership at separate logical times.
- Remove long-lived per-consumer `MapSet` views from event handlers.
- Remove per-shape exact membership rows from `SubqueryIndex`.
- Keep routing conservative while consumers are at different logical times.
- Keep first-time child creation correct by synchronously seeding routing before
  the child is considered indexed.
- Keep shape removal proportional to the shape's subquery participants and
  routing edges, not to the full dependency view.
- Preserve correctness for positive subqueries, negated subqueries, `AND`,
  `OR`, and `NOT`.
- Avoid changing the client wire protocol.

### Non-Goals

- Do not change Electric's HTTP protocol.
- Do not change supported subquery semantics.
- Do not redesign DNF planning, tags, or `active_conditions`.
- Do not remove the need to materialize SQL array parameters for move-in
  queries in the first implementation. The goal is to avoid long-lived copies;
  transient query-local arrays may remain.
- Do not make negated-subquery routing better than
  `O(number_of_affected_shapes)`. If a value is absent from a large negated
  group, all of those shapes are genuinely affected.
- Do not intern equivalent SQL subqueries that have different dependency shape
  handles. A `subquery_id` is the dependency shape handle for v1.

## Proposal

### Core Idea

Move subquery membership out of per-shape state and into one versioned view per
subquery:

```text
MultiTimeView[{subquery_id, value}] -> membership_history
consumer[{shape_handle, subquery_ref}] -> {subquery_id, logical_time}
```

Consumers no longer copy the subquery view. They register each subquery they
read, store the logical time returned by the materializer, and ask
`MultiTimeView.member?(subquery_id, value, time)` when they need exact
membership.

The filter index no longer stores exact per-shape membership rows. It stores
compact routing topology:

```text
subquery_group_id
child_node_id per {subquery_group_id, subquery_id}
shape participant rows
fallback rows while initial indexing is incomplete
```

Positive routing is value-keyed for values that are members at some retained
logical time. Negated routing is group-keyed and then filtered by shared
membership history.

### Architecture

```text
Dependency materializer
  -> writes MultiTimeView at monotonically increasing logical times
  -> emits dependency move events with from_time and to_time

Consumer event handler
  -> registers subqueries through the materializer
  -> stores subquery_id and logical times, not MapSet views
  -> calls notify_processed_up_to/2 after old times are no longer needed

SubqueryIndex
  -> stores subquery groups, child nodes, and participant routing
  -> asks MultiTimeView for membership at some/all retained times for routing
  -> over-routes when consumers diverge; exact split is the consumer's job
```

Routing is intentionally conservative: when consumers diverge across logical
times — including the common case of a single consumer that is mid-move and
effectively reading at two times at once — the filter cannot encode that with
a per-shape logical-time pin. Exact membership is therefore checked at
`Shape.convert_change`/`WhereClause.includes_record?/3`, using a
`subquery_member?` callback that the consumer builds from its own logical
time(s) against `MultiTimeView`.

### Definitions

#### Subquery

A subquery is represented by its dependency shape. The `subquery_id` is the
dependency shape handle.

Different `SELECT` statements are different subqueries, even if they differ
only by constants. For example:

```sql
SELECT id FROM users WHERE company_id = 7
SELECT id FROM users WHERE company_id = 8
```

These get different `subquery_id` values.

#### Subquery Group

A subquery group is a set of subquery occurrences with the same filter tree
node, field key, and polarity.

For example, these outer shapes use different subqueries but can share the same
subquery group if the occurrence is at the same filter node:

```sql
WHERE user_id IN (SELECT id FROM users WHERE company_id = 7)
WHERE user_id IN (SELECT id FROM users WHERE company_id = 8)
```

The field key is `user_id`, and the polarity is positive.

#### Child Node

A `child_node_id` is created per `{subquery_group_id, subquery_id}` pair.

The child node owns a child `WhereCondition` containing all outer shapes using
that subquery in that group. Many outer shapes can therefore share one child
node.

#### Logical Time

Logical time is a monotonically increasing integer per subquery.

Time `0` represents the materializer's initial view. Each committed dependency
move that changes subquery membership increments the logical time and records
the transition at the new time.

Use normal BEAM integers. Wrapping is unnecessary and would make comparison and
compaction harder to reason about.

#### Processed-Up-To Time

The public progress API is:

```elixir
SubqueryProgressMonitor.notify_processed_up_to(time, subquery_id)
```

Consumers call this after they no longer need to read the subquery at `time` or
earlier. For a move from logical time `a` to logical time `b`, once the
consumer has finished processing that move and is steady at `b`, it notifies
that it has processed up to `a`.

Internally, the monitor tracks `required_time`: the earliest logical time a
live consumer may still read. `notify_processed_up_to(a, subquery_id)` advances
that consumer's `required_time` to `a + 1`.

The compaction lower bound is:

```text
min(required_time_for_live_consumers)
```

Consumers register at the logical time they are starting from. If a consumer
starts from current logical time `t`, its initial `required_time` is `t`
because it may read time `t`.

`required_time` is a retention bound. It is separate from the consumer's current
logical time for a specific subquery. During an active move, a consumer may need
the old time for buffered conversion or move-in query work while its current
logical time for that subquery has already advanced to the new time. The
implementation must keep `required_time` and per-subquery `logical_time`
explicit.

### MultiTimeView

`Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView` stores one
shared view per subquery in ETS, with one table per stack.

The logical key is:

```text
{subquery_id, value} -> membership_history
```

Absence means the value is not a member at any retained logical time.

The common case is a value that is always present for the retained window. That
is represented as an empty history:

```elixir
[]
```

Values that moved use compact flat histories:

```elixir
[:out, 9]
[:out, 9, 11]
[:in, 9]
[:in, 9, 11]
```

The first list item is membership before the first transition. Each integer
after it is a logical time where membership toggles from that time onwards.

Examples:

```elixir
# Out before 9, in from 9 onwards.
[:out, 9]

# Out before 9, in from 9 to 10, out from 11 onwards.
[:out, 9, 11]

# In before 9, out from 9 to 10, in from 11 onwards.
[:in, 9, 11]
```

Use `[]` rather than `true` for the always-present case for consistency with
other histories. On BEAM, both `[]` and `true` are immediate terms, so neither
is more compact as an ETS value.

Use flat lists such as `[:out, 9]` rather than tuples containing lists such as
`{:out, [9]}` because the flat list is smaller and is enough for the common
short-history case.

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

### Compaction

`SubqueryProgressMonitor` provides the minimum required logical time for each
subquery. `MultiTimeView` can compact entries by evaluating membership at that
time and removing transitions at or before it.

Compaction must preserve membership at all retained times. For example:

```elixir
[:out, 9, 11]
```

If `min_required_time = 10`, membership at time `10` is `true`, and the
compacted history becomes:

```elixir
[:in, 11]
```

If `min_required_time = 12`, the value is out for the whole retained window, so
the row can be deleted.

Compaction should run:

- when a value is read
- when a value is written
- in a periodic asynchronous pass
- when a consumer unregisters and releases the minimum pinned time

### SubqueryIndex Data Model

The hot ETS rows should use compact integer IDs for groups, children, and
subqueries where practical. Full shape handles and dependency handles can be
stored in metadata rows and interned at boundaries.

Suggested logical rows:

```text
{:group, group_key} -> group_id
{:child, group_id, subquery_id} -> child_node_id
{:child_meta, child_node_id} -> {group_id, subquery_id, polarity, next_condition_id}
{:subquery_child, subquery_id} -> child_node_id
{:child_shape, child_node_id} -> {shape_handle, branch_key}
{:shape_child, shape_handle} -> child_node_id
{:shape_subquery, shape_handle, subquery_ref} -> {subquery_id, logical_time}
{:fallback, shape_handle} -> true
```

Positive routing keeps value-keyed entries:

```text
{:positive, group_id, value} -> child_node_id
```

Negated routing keeps group-keyed entries:

```text
{:negated, group_id} -> child_node_id
```

This replaces per-shape value membership rows with per-child routing rows and a
shared membership view.

### First-Time Child Creation

First-time child creation must seed synchronously.

When `SubqueryIndex` creates a new `child_node_id` for
`{subquery_group_id, subquery_id}`, it must:

1. Ensure the dependency materializer has populated `MultiTimeView` and marked
   the subquery ready.
2. Create the child `WhereCondition`.
3. Insert the outer shapes into the child condition.
4. Seed positive routing for every value in
   `MultiTimeView.values(subquery_id, current_time)`.
5. Add negated group routing if the group is negated.
6. Remove fallback only after the child is fully routable.

This is `O(number_of_values_in_subquery)` for the first child of a
`{group, subquery_id}` pair. That cost is acceptable because it happens on
child creation, not on every consumer using the same child.

### Routing

Positive routing should route a root-table value to a child if the value is a
member of the child subquery at any retained logical time:

```elixir
MultiTimeView.member_at_some_time?(subquery_id, value)
```

This is conservative. If some consumers still read an old time and others read
a new time, both old and new members remain routable until compaction proves no
consumer can read the old time.

Negated routing should enumerate the negated children for the group and keep
children where the value is not a member at all retained times:

```elixir
not MultiTimeView.member_at_all_times?(subquery_id, value)
```

This is `O(number_of_affected_shapes)` for large negated groups. That is
acceptable because a value absent from a large negated group genuinely affects
all of those shapes.

Exact membership verification is not done by the filter. The filter cannot
correctly perform a per-shape split at routing time because, during a buffered
move-in, a consumer is effectively reading at *both* `from_time` and `to_time`
for the same subquery — splice-plan evaluates buffered transactions at
`MTV(from_time)` for pre-ops and `MTV(to_time)` for post-ops. A single
per-shape logical-time pin in the filter cannot represent that, and the filter
does not know how a given record relates to a given consumer's move window
without duplicating consumer state.

Therefore the boundary at which exact membership is evaluated is the consumer,
via the `subquery_member?` callback passed into `WhereClause.includes_record?/3`
from `Shape.convert_change`. The consumer constructs that callback from its own
per-subquery logical time(s) — one callback for the steady case, two callbacks
(`old_member?` and `new_member?`) during a buffered move — and calls
`MultiTimeView.member?(subquery_id, typed_value, logical_time)` against the
shared view.

The filter does maintain `{shape_handle, subquery_ref} -> {subquery_id,
logical_time}` rows so it can answer exact membership for sublink refs that
survive in the residual `and_where` (i.e. sublinks at *other* positions in the
shape's WHERE that were not the routed position). For those, the filter's
`subquery_member_from_index` callback is sufficient because the shape is not
mid-move on that other position at this routing step.

### Operation Examples And Costs

Use this concrete setup for the examples:

```sql
-- subquery_id = s7, current logical time 0
SELECT id FROM users WHERE company_id = 7
-- current values: 10, 20

-- subquery_id = s8, current logical time 0
SELECT id FROM users WHERE company_id = 8
-- current values: 30
```

Outer shapes:

```sql
-- shape_a and shape_b share the same positive group and subquery.
WHERE user_id IN (SELECT id FROM users WHERE company_id = 7)

-- shape_c uses the same positive group but a different subquery.
WHERE user_id IN (SELECT id FROM users WHERE company_id = 8)

-- shape_n uses a negated group for s7.
WHERE user_id NOT IN (SELECT id FROM users WHERE company_id = 7)
```

#### Initial `MultiTimeView` State

The initial materializer state for `s7` stores one row per dependency value,
not one row per outer shape:

```text
{s7, 10} -> []
{s7, 20} -> []
{:current_time, s7} -> 0
{:min_required_time, s7} -> 0
{:ready, s7} -> true
```

The empty history means the value is present for the whole retained window.

Memory is `O(number_of_values_in_subquery_retained_window)` for the shared
view. In this example, `shape_a` and `shape_b` do not duplicate `{10, 20}`.

#### `register_subquery_consumer`

Before an outer consumer can read `s7`, it registers through the materializer:

```elixir
{:ok, 0} =
  Materializer.register_subquery_consumer(
    s7,
    shape_a,
    consumer_pid_a
  )
```

Progress monitor rows are conceptually:

```text
{s7, shape_a} -> required_time 0
{s7, 0, shape_a} -> true
```

The shape's subquery reference is then recorded by the indexing/setup path:

```text
{:shape_subquery, shape_a, ["$sublink", "0"]} -> {s7, 0}
```

If registration is called from `add_shape`, this row is inserted once as part
of that setup path; it is shown here to make the registration result explicit.

What is evaluated:

1. Wait until `s7` is ready.
2. Read `{:current_time, s7}`.
3. Insert progress monitor rows for `shape_a`.
4. Return `0` to the consumer.

Cost:

```text
O(wait_until_ready + progress_index_insert)
```

No dependency values are copied. Memory added is
`O(number_of_subqueries_read_by_shape)`.

#### `add_shape`: First Positive Shape For `{group, subquery}`

Adding `shape_a` creates a positive group `g_user_pos` and a child `c_s7_pos`
for `{g_user_pos, s7}`.

Rows stored:

```text
{:group, {:node_1, :user_id, :positive}} -> g_user_pos
{:child, g_user_pos, s7} -> c_s7_pos
{:child_meta, c_s7_pos} -> {g_user_pos, s7, :positive, wc_s7_pos}
{:subquery_child, s7} -> c_s7_pos

{:child_shape, c_s7_pos} -> {shape_a, branch_a}
{:shape_child, shape_a} -> c_s7_pos
{:shape_subquery, shape_a, ["$sublink", "0"]} -> {s7, 0}

{:positive, g_user_pos, 10} -> c_s7_pos
{:positive, g_user_pos, 20} -> c_s7_pos
```

The child `WhereCondition` `wc_s7_pos` also stores `shape_a` with the residual
non-subquery predicates for the branch.

What is evaluated:

1. Compile or reuse the DNF subquery group key.
2. Register the consumer with the dependency materializer and get logical time
   `0`.
3. Create the child `WhereCondition`.
4. Insert `shape_a` into the child condition.
5. Synchronously seed positive routing from `MultiTimeView.values(s7, 0)`.
6. Remove fallback for `shape_a`.

Cost:

```text
O(
  number_of_subquery_occurrences_in_shape +
  number_of_values_in_s7_retained_window +
  child_where_insert
)
```

The value-count term only applies because this is the first child for
`{g_user_pos, s7}`. Memory added is
`O(number_of_values_in_s7_retained_window)` positive routing rows for the child
plus `O(number_of_subquery_occurrences_in_shape)` participant rows.

#### `add_shape`: Additional Shape Sharing An Existing Child

Adding `shape_b` finds the existing child `c_s7_pos`.

Rows added:

```text
{:child_shape, c_s7_pos} -> {shape_b, branch_b}
{:shape_child, shape_b} -> c_s7_pos
{:shape_subquery, shape_b, ["$sublink", "0"]} -> {s7, 0}
```

No new rows are added for values `10` or `20`.

What is evaluated:

1. Resolve `{g_user_pos, s7}` to `c_s7_pos`.
2. Register the consumer and get logical time `0`.
3. Insert `shape_b` into the child condition.
4. Remove fallback for `shape_b`.

Cost:

```text
O(number_of_subquery_occurrences_in_shape + child_where_insert)
```

Memory added is per-shape metadata only, not
`O(number_of_values_in_s7_retained_window)`.

#### `add_shape`: Same Group, Different Subquery

Adding `shape_c` reuses group `g_user_pos`, but creates child `c_s8_pos` for
`{g_user_pos, s8}`.

Rows added include:

```text
{:child, g_user_pos, s8} -> c_s8_pos
{:child_meta, c_s8_pos} -> {g_user_pos, s8, :positive, wc_s8_pos}
{:subquery_child, s8} -> c_s8_pos
{:positive, g_user_pos, 30} -> c_s8_pos
{:shape_subquery, shape_c, ["$sublink", "0"]} -> {s8, 0}
```

Cost is `O(number_of_values_in_s8_retained_window)` for the first `s8` child in
this group. This is expected: `s8` has different dependency values from `s7`.

#### `add_shape`: Negated Shape

Adding `shape_n` creates or reuses a negated group `g_user_neg` and child
`c_s7_neg`.

Rows stored:

```text
{:group, {:node_2, :user_id, :negated}} -> g_user_neg
{:child, g_user_neg, s7} -> c_s7_neg
{:child_meta, c_s7_neg} -> {g_user_neg, s7, :negated, wc_s7_neg}
{:subquery_child, s7} -> c_s7_neg
{:negated, g_user_neg} -> c_s7_neg

{:child_shape, c_s7_neg} -> {shape_n, branch_n}
{:shape_child, shape_n} -> c_s7_neg
{:shape_subquery, shape_n, ["$sublink", "0"]} -> {s7, 0}
```

No per-value negated routing rows are stored.

Cost:

```text
O(number_of_subquery_occurrences_in_shape + child_where_insert)
```

Memory added for negated routing is `O(1)` per child, not
`O(number_of_values_in_s7_retained_window)`.

#### `affected_shapes`: Positive Group

For a root-table record:

```text
%{"user_id" => 10}
```

Routing does:

1. Evaluate the left-hand side `user_id` to `10`.
2. Look up `{:positive, g_user_pos, 10}` and get `[c_s7_pos]`.
3. Evaluate child condition `wc_s7_pos`, which considers `shape_a` and
   `shape_b`.
4. Return both as candidates. No exact membership check happens in the filter
   at the routed position — that's the consumer's job in `convert_change`.

In this case the consumers in both shapes will confirm `10 ∈ s7` at their
logical time and the record is delivered:

```text
MultiTimeView.member?(s7, 10, 0) -> true   # shape_a
MultiTimeView.member?(s7, 10, 0) -> true   # shape_b
```

Both shapes are affected.

Cost at the filter:

```text
O(children_for_value + child_where_eval)
```

For this example, `children_for_value = 1`. There is no scan of all shapes and
no scan of all values in `s7`. The per-consumer exact check is paid downstream
in `convert_change`, at `O(transition_history_length_for_value)` per shape.

#### `affected_shapes`: Positive Group With Divergent Consumer Times

Suppose the materializer adds value `30` to `s7` at logical time `1`:

```text
{s7, 30} -> [:out, 1]
{:current_time, s7} -> 1
{:positive, g_user_pos, 30} -> c_s7_pos
```

Now `shape_a` has advanced to logical time `1`, but `shape_b` still reads
logical time `0`:

```text
{:shape_subquery, shape_a, ["$sublink", "0"]} -> {s7, 1}
{:shape_subquery, shape_b, ["$sublink", "0"]} -> {s7, 0}
```

For:

```text
%{"user_id" => 30}
```

routing finds `c_s7_pos` because `30` is a member at some retained time. The
filter returns both `shape_a` and `shape_b` as candidates — it does *not*
attempt to split them at this point. The downstream exact check then drops the
false positive at each consumer:

```text
# In shape_a's consumer, evaluating includes_record? at logical_time 1:
MultiTimeView.member?(s7, 30, 1) -> true   # shape_a keeps the record

# In shape_b's consumer, evaluating includes_record? at logical_time 0:
MultiTimeView.member?(s7, 30, 0) -> false  # shape_b drops the record
```

End-to-end, only `shape_a` emits the change. `shape_b` over-routes briefly but
filters the record in `Shape.convert_change`.

Cost at the filter remains:

```text
O(children_for_value + child_where_eval)
```

The per-consumer exact check is paid downstream, in `convert_change`, at:

```text
O(transition_history_length_for_value) per shape
```

The extra memory for the move is one history row for `{s7, 30}` plus one
positive routing row per positive child for `s7` in that group.

#### `affected_shapes`: Negated Group

For:

```text
%{"user_id" => 30}
```

while `{s7, 30} -> [:out, 1]` is retained, `30` is absent at time `0` and
present at time `1`. Negated routing does:

1. Look up `{:negated, g_user_neg}` and get `[c_s7_neg]`.
2. Keep `c_s7_neg` because:

```elixir
not MultiTimeView.member_at_all_times?(s7, 30)
```

3. Evaluate `wc_s7_neg` and return the attached negated shapes as candidates.

Per-shape correctness for the negated case is again paid in
`Shape.convert_change`: for `shape_n` at logical time `0`, `NOT IN s7` is true
for `30`; if it later advances to logical time `1`, `NOT IN s7` is false for
`30`. That distinction is made by the consumer, not the filter.

Cost at the filter:

```text
O(
  number_of_negated_children_in_group * transition_history_length_for_value +
  child_where_eval
)
```

This is intentionally proportional to the number of negated children kept by
routing. No complement index is stored. The per-consumer exact check is again
paid downstream in `convert_change`, at
`O(transition_history_length_for_value)` per shape.

#### Dependency Move: Add Or Remove Values

For a move that adds `30` to `s7`:

```text
from_time = 0
to_time = 1
changed_values = [30]
```

Rows written:

```text
{s7, 30} -> [:out, 1]
{:current_time, s7} -> 1
{:positive, g_user_pos, 30} -> c_s7_pos
```

Rows not written:

```text
{:membership, shape_a, ["$sublink", "0"], 30}
{:membership, shape_b, ["$sublink", "0"], 30}
```

What is evaluated:

1. Update the `MultiTimeView` history for each changed value.
2. Find children from `{:subquery_child, s7}`.
3. For each positive child, insert a positive routing row if the value changed
   from not routable to routable for the retained window.
4. Emit a move event containing `from_time`, `to_time`, `subquery_id`, and
   changed values.

Cost:

```text
O(number_of_changed_values * (history_update + child_nodes_for_subquery))
```

For a remove of `20` from `s7` at time `2`, the history becomes:

```text
{s7, 20} -> [:in, 2]
```

The positive routing row for `20` stays while any retained time still contains
`20`. It is removed later when compaction proves `member_at_some_time?(s7, 20)`
is false.

#### Consumer Move Handling

When `shape_a` receives the `s7` move from `0` to `1`, `ActiveMove` stores:

```elixir
%ActiveMove{
  subquery_id: s7,
  from_time: 0,
  to_time: 1,
  move_in_values:  [{30, "30"}],
  move_out_values: []
}
```

It does not store:

```text
views_before_move: MapSet.new([10, 20])
views_after_move: MapSet.new([10, 20, 30])
```

Buffered row conversion evaluates exact membership by calling
`MultiTimeView.member?/3` at `from_time` or `to_time`. Move-in SQL may
materialise `values(s7, 1)` as a query-local parameter array, but that memory
belongs to the query task and is released after the query.

If additional materializer payloads for `s7` queue up during `shape_a`'s
buffering — say a move-in of `{40, "40"}` at time `2` and a move-out of
`{20, "20"}` at time `3` — they reduce into the *next* combined batch the
consumer pops after splicing this move:

```elixir
%ActiveMove{
  subquery_id: s7,
  from_time: 1,
  to_time: 3,
  move_in_values:  [{40, "40"}],
  move_out_values: [{20, "20"}]
}
```

`from_time` here is the consumer's processed time when the first follow-up
payload arrived (i.e. `shape_a`'s previous `ActiveMove.to_time`); `to_time`
is the max of the contributing `to_time`s; the value lists are the reduced
net effect. By construction
`MTV(s7, 3) = MTV(s7, 1) + {40} - {20}`.

Steady memory added per active move is:

```text
O(number_of_changed_values + number_of_subquery_refs)
```

not `O(number_of_values_in_s7_retained_window)`.

#### `notify_processed_up_to` And Compaction

After `shape_a` no longer needs time `0`, it calls:

```elixir
SubqueryProgressMonitor.notify_processed_up_to(0, s7)
```

Progress monitor rows conceptually change from:

```text
{s7, shape_a} -> required_time 0
{s7, shape_b} -> required_time 0
```

to:

```text
{s7, shape_a} -> required_time 1
{s7, shape_b} -> required_time 0
```

The minimum is still `0`, so `MultiTimeView` cannot compact away time `0`.
After `shape_b` also notifies up to `0`, the minimum becomes `1`. Then:

```text
{s7, 30} -> [:out, 1]
```

can compact to:

```text
{s7, 30} -> []
```

For a removed value:

```text
{s7, 20} -> [:in, 2]
```

if the minimum required time later advances past `2`, compaction can delete the
`MultiTimeView` row and remove stale positive routes:

```text
delete {s7, 20}
delete {:positive, g_user_pos, 20} -> c_s7_pos
```

Cost for notification:

```text
O(progress_index_update + min_recompute_for_subquery)
```

With an index keyed by `{subquery_id, required_time, consumer_id}`, reading the
minimum is `O(1)` or `O(log consumers_for_subquery)` depending on the ETS
layout chosen. Compaction cost is paid separately and can be incremental. For
one compacted value it is:

```text
O(transition_history_length_for_value + positive_children_for_subquery)
```

If compaction is batched, total work is proportional to the histories visited
and the stale route rows removed.

#### Move-In Query Construction

For the `s7` move from time `0` to `1`, existing SQL generation may still need
arrays for the before and after views. The new design builds them from
`MultiTimeView` inside the query task:

```elixir
values_for.(["$sublink", "0"], 0) -> [10, 20]
values_for.(["$sublink", "0"], 1) -> [10, 20, 30]
```

What is stored persistently:

```text
nothing beyond the ActiveMove times and changed values
```

What is allocated transiently:

```text
query-local arrays for values(s7, 0) and values(s7, 1)
move-in snapshot rows returned by Postgres
```

Cost for the compatibility implementation:

```text
O(number_of_values_in_s7_retained_window + root_rows_returned_by_move_in_query)
```

This does not yet minimize move-in query memory, but it moves full-view arrays
out of steady consumer state and into short-lived query tasks.

#### `remove_shape`

Removing `shape_a` reads:

```text
{:shape_child, shape_a} -> c_s7_pos
{:shape_subquery, shape_a, ["$sublink", "0"]} -> {s7, 1}
```

Rows removed:

```text
{:child_shape, c_s7_pos} -> {shape_a, branch_a}
{:shape_child, shape_a} -> c_s7_pos
{:shape_subquery, shape_a, ["$sublink", "0"]} -> {s7, 1}
```

The monitor registration for `{shape_a, s7}` is removed. `shape_a` is removed
from the child `WhereCondition`.

If `shape_b` still uses `c_s7_pos`, no value routing rows are touched. Cost is:

```text
O(children_for_shape + subqueries_for_shape + child_where_remove)
```

If this removes the last shape from `c_s7_pos`, the child is deleted too:

```text
{:child, g_user_pos, s7}
{:child_meta, c_s7_pos}
{:subquery_child, s7} -> c_s7_pos
{:positive, g_user_pos, value} -> c_s7_pos for each retained value
```

The positive route cleanup iterates `MultiTimeView.values(s7)` and deletes the
specific `{group, value, child}` route rows. That last-child case costs:

```text
O(number_of_values_in_s7_retained_window + child_metadata)
```

It does not scan unrelated subqueries or unrelated shapes.

#### `remove_subquery`

Removing dependency subquery `s7` reads:

```text
{:subquery_child, s7} -> c_s7_pos
{:subquery_child, s7} -> c_s7_neg
```

Then it removes:

```text
child metadata for c_s7_pos and c_s7_neg
participant rows for shapes attached to those children
positive routing rows for s7 values
negated group rows for s7 negated children
MultiTimeView rows with key prefix s7
progress monitor rows for s7
```

Cost:

```text
O(
  child_nodes_for_subquery +
  sum(shapes_attached_to_each_child) +
  number_of_values_in_s7_retained_window
)
```

This is proportional to the removed subquery's children, participants, and
values. It should not scan the whole `SubqueryIndex` or all shapes in the
stack.

### Memory Savings Prototype

The prototype script is:

```text
packages/sync-service/scripts/subquery_logical_time_memory.exs
```

Run it directly with Elixir so it does not start the sync-service application:

```sh
elixir scripts/subquery_logical_time_memory.exs
```

There is also a focused test file:

```text
packages/sync-service/test/electric/shapes/filter/subquery_logical_time_memory_bench_test.exs
```

The prototype compares:

- the current model: current `SubqueryIndex`-style ETS rows, per-consumer
  `MapSet` views, and active-move before/after views;
- the logical-time model: shared `MultiTimeView` rows, shared child routing and
  metadata rows, progress-monitor rows, compact per-consumer subquery
  references, and active moves that store changed values plus logical times.

The model intentionally uses small integer dependency values. That is
conservative for workloads with large text, UUID, or composite values because
the current model duplicates those values per shape, while the logical-time
model stores them once per retained subquery value plus routing rows.

The local run below was generated on:

```text
OTP: 28
Elixir: 1.19.5
Architecture: aarch64-apple-darwin24.5.0
Word size: 8 bytes
```

#### Local Measured Scenarios

| Scenario | Current total | Current index | Current consumers | Logical total | Logical ETS | Logical consumers | Savings |
|----------|---------------|---------------|-------------------|---------------|-------------|-------------------|---------|
| 1 shape, 1k values, steady | 331.6 KiB | 302.4 KiB | 29.3 KiB | 222.9 KiB | 222.6 KiB | 256 B | 32.8% |
| 10 shapes, 1k values, steady | 3.2 MiB | 2.91 MiB | 292.5 KiB | 229.1 KiB | 226.6 KiB | 2.5 KiB | 93.0% |
| 100 shapes, 1k values, steady | 31.92 MiB | 29.06 MiB | 2.86 MiB | 290.9 KiB | 265.9 KiB | 25.0 KiB | 99.1% |
| 100 shapes, 10k values, steady | 318.9 MiB | 290.02 MiB | 28.87 MiB | 1.78 MiB | 1.76 MiB | 25.0 KiB | 99.4% |
| 100 shapes, 1k base, 100 added x 10 advanced | 32.24 MiB | 29.35 MiB | 2.88 MiB | 309.6 KiB | 284.6 KiB | 25.0 KiB | 99.1% |
| 100 shapes, 1k base, 100 added x 99 advanced | 35.07 MiB | 31.94 MiB | 3.13 MiB | 309.6 KiB | 284.6 KiB | 25.0 KiB | 99.1% |
| 100 shapes, 1k base, 100 added x 10 active move | 32.87 MiB | 29.35 MiB | 3.52 MiB | 349.8 KiB | 284.6 KiB | 65.2 KiB | 99.0% |
| 100 shapes, 1k base, 1k added x 99 active move | 75.51 MiB | 57.77 MiB | 17.75 MiB | 4.25 MiB | 453.4 KiB | 3.81 MiB | 94.4% |

Interpretation:

- Subqueries used by one shape still save memory, but only by a constant
  factor. There is no sharing benefit when a subquery has one participant.
- Shared steady-state subqueries get the largest win because the current model
  stores value membership and consumer views once per shape.
- Active moves remain materially smaller because the logical-time model stores
  changed values and times, not before and after full dependency views.
- The harsh `1k added x 99 active move` case still grows because every active
  move stores the changed values. It is still much smaller than the current
  model because it avoids duplicating the 1k base view twice per active move.

#### Customer-Shaped Estimates

These estimates use the same script. They extrapolate from measured row costs
and use the customer workload ratios from PR #4280:

- HumanLayer: 75 observed `WHERE` clauses, 134 subquery occurrences, 13
  distinct literal subqueries.
- AutoArc: 611 observed `WHERE` clauses, 291 subquery occurrences, 209
  distinct literal subqueries.
- Hazel: 13 observed shape handles, 4 subquery occurrences, 4 distinct literal
  subqueries.

The extrapolation is for 100k shapes and preserves each workload's observed
ratio of subquery occurrences to distinct literal subqueries. A distinct
literal subquery here means a distinct dependency subquery, not a subquery
group.

| Customer | Observed occurrences -> distinct subqueries | Shared occurrences | Participants @100k | Distinct subqueries @100k | Rows/subquery | Current | Logical-time | Savings |
|----------|----------------------------------------------|--------------------|--------------------|---------------------------|---------------|---------|--------------|---------|
| HumanLayer | 134 -> 13 | 90.3% | 178,667 | 17,334 | 1,000 | 55.77 GiB | 4.2 GiB | 92.5% |
| HumanLayer | 134 -> 13 | 90.3% | 178,667 | 17,334 | 10,000 | 556.19 GiB | 40.59 GiB | 92.7% |
| AutoArc | 291 -> 209 | 28.2% | 47,627 | 34,207 | 1,000 | 14.87 GiB | 8.04 GiB | 45.9% |
| AutoArc | 291 -> 209 | 28.2% | 47,627 | 34,207 | 10,000 | 148.26 GiB | 79.86 GiB | 46.1% |
| Hazel | 4 -> 4 | 0.0% | 30,770 | 30,770 | 1,000 | 9.61 GiB | 7.23 GiB | 24.8% |
| Hazel | 4 -> 4 | 0.0% | 30,770 | 30,770 | 10,000 | 95.79 GiB | 71.83 GiB | 25.0% |

Interpretation:

- HumanLayer benefits most because the captured workload has high literal
  subquery sharing.
- AutoArc still benefits, but many literal subqueries are not shared, so the
  logical-time model stores more per-subquery shared views.
- Hazel has no observed literal sharing. The estimate still shows a constant
  factor reduction because the current model stores both index membership rows
  and consumer `MapSet` views per shape, while the logical-time model stores
  one shared view per one-participant subquery and compact consumer references.
- If a production workload has one-off subqueries with large dependency views,
  the logical-time design is still better than current state, but it is not the
  main win. The main win comes when multiple shapes share a subquery.

### Materializer Integration

The materializer owns the source of truth for a dependency subquery. It should
populate `MultiTimeView` during initial materialization and mark the subquery
ready only after the full initial view is visible.

When a committed dependency change alters membership, the materializer should:

1. Read the current logical time `a`.
2. Increment to logical time `b`.
3. Write the transition into `MultiTimeView` at `b`.
4. Update positive routing before emitting the move if the value is newly
   routable at some retained time.
5. Emit the dependency move with `from_time: a`, `to_time: b`, `subquery_id`,
   changed values, and move kind.

Consumers must not observe a move event whose target time is absent from
`MultiTimeView`.

### Consumer Registration

Consumers register for each subquery they read. Registration should be
serialized through the dependency materializer so the returned time and the
shared view are consistent:

```elixir
{:ok, current_time} =
  Materializer.register_subquery_consumer(
    subquery_id,
    outer_shape_handle,
    self()
  )
```

The registration side effects are:

- wait until the dependency materializer has finished initial population
- register the consumer with `SubqueryProgressMonitor`
- set the consumer's initial `required_time` to `current_time`
- **atomically add the consumer to the materializer's subscribers list**
  before returning `current_time`
- return `current_time` to the caller

The atomic-subscribe step is required for correctness. A two-call shape
("register, then subscribe") opens a race window where the materializer
commits between the calls: those commits go to the *old* subscribers list
and the new consumer never sees them. Its `current_time` stays at the value
returned by `register`, but the materializer's logical time has advanced
past it, so the consumer's first observable `materializer_changes` event
arrives with a `from_time` strictly greater than `current_time` — and
`MTV(current_time)` no longer reflects "what the consumer has processed."
That breaks the times-as-views invariant the rest of the design depends on
(see *Consumer Move Handling* below).

This replaces the current `Materializer.get_link_values/1` setup path for
subquery event handlers. The handler should keep compact references such as:

```elixir
%{
  ["$sublink", "0"] => %{subquery_id: dep_handle, time: current_time}
}
```

not `MapSet` views.

The monitor should track consumers by process monitor plus registered
subqueries so dead consumers automatically release pinned times. An explicit
unregister path can be added for normal shutdown, but correctness must not
depend on it.

### Consumer Move Handling

For a move from time `a` to time `b`, `ActiveMove` should store times and
the values whose membership changed between those times. It does *not* store
view snapshots:

```elixir
%ActiveMove{
  subquery_id: subquery_id,
  dep_index: dep_index,
  subquery_ref: subquery_ref,
  from_time: a,
  to_time: b,
  move_in_values: ins,    # values entering the dep view in [a, b]
  move_out_values: outs,  # values leaving the dep view in [a, b]
  txids: [...],           # source PG xids
  ...                     # snapshot/query state for the move-in query
}
```

Elixir-side evaluation of buffered transactions uses callbacks into
`MultiTimeView`:

```elixir
before_member? = fn ref, value -> member?(ref, value, a) end
after_member? = fn ref, value -> member?(ref, value, b) end
```

For SQL move-in queries, the first implementation can still materialise
query-local arrays by calling `MultiTimeView.values(subquery_id, time)`. The
important change is that these arrays are transient query parameters, not
long-lived per-consumer state.

After the move is spliced and the consumer no longer needs time `a`, it calls:

```elixir
SubqueryProgressMonitor.notify_processed_up_to(a, subquery_id)
```

The consumer's current logical time for that subquery is separate from this
retention notification. It should advance to `b` at the same point the current
implementation would update per-shape membership rows for subsequent routing.
The important invariant is that live routing must not under-route, while
`required_time` continues to pin `a` until the consumer no longer needs the old
view.

#### Combined Move Batches (Times vs Views)

The pre-RFC implementation stores frozen `MapSet` `views_before_move` and
`views_after_move`. Those snapshots are *path-dependent*: they reflect what
this consumer has processed, in the order it chose to process it. The
consumer's MoveQueue freely reorders move-outs ahead of move-ins because set
operations on disjoint values commute, so the consumer's final view is
unchanged.

`MultiTimeView` doesn't have that freedom. `MTV(t)` is the materializer's
canonical view at logical time `t` — and the materializer applies moves in
PG commit order. Times are points in a totally ordered history, not view
deltas. So the consumer cannot pop the move-out batch first and "advance to
some intermediate time where only the outs have been applied" — no such
time exists if a move-in committed between them.

To preserve the times-as-views invariant
(`MTV(consumer.time) = what the consumer has processed so far`), an
`ActiveMove` covers a *single contiguous window* `[a, b]` per dep and carries
*both* move-in and move-out values for that window. `MoveQueue.pop_next/1`
returns one combined batch per dep at a time:

```elixir
{:ok, batch} = MoveQueue.pop_next(queue)
# batch = %{
#   dep_index: 0,
#   move_in_values:  [{V2, "V2"}, {V3, "V3"}],
#   move_out_values: [{V1, "V1"}],
#   from_time: a,
#   to_time: b,
#   txids: [...]
# }
```

The batch's `from_time` is the consumer's processed time when the *first*
payload in the window arrived (preserved across subsequent enqueues for the
same dep). The `to_time` is the max of the contributing payload `to_time`s.
By construction of the queue's per-dep reduce,
`MTV(b) = MTV(a) + move_in_values - move_out_values`.

The splice plan for a combined batch emits effects in this order:

```
pre_ops           — buffered txns before move-in snapshot, evaluated at MTV(a)
move_out_broadcast — for outer move-out values (may be empty)
move_in_broadcast — for outer move-in values (may be empty)
snapshot          — records loaded by the move-in query
post_ops          — buffered txns after snapshot, evaluated at MTV(b)
```

`pre_ops` first means a buffered txn that references a value about to be
moved out is stored at the *pre-batch* view (consistent with `MTV(a)`), and
the subsequent move-out broadcast cleans it up — the client sees `UPDATE
then DELETE` for that row, never `DELETE then UPDATE` (which would surface
as "update for row that does not exist").

For pure move-out batches (no move-in values, hence no PG query needed) the
consumer skips Buffering and broadcasts the move-out inline, advancing time
to `b` and recursing on the queue.

#### MoveQueue Compaction Rules

Per dep, within one contiguous window `[a, b]`, the queue may compact
arbitrary sequences of moves into a single `(move_in_values, move_out_values)`
pair as long as the net effect preserves
`MTV(b) = MTV(a) + ins - outs`. Specifically:

- multiple adds of the same value collapse to one (idempotent)
- multiple removes of the same value collapse to one
- `add V` then `remove V` cancel (net zero)
- `remove V` then `add V` cancel (net zero)
- adds and removes for disjoint values keep both

This is the same reduce the pre-RFC queue uses; the only change is that the
result is now expressed as two value lists carried by one `ActiveMove`,
rather than two batches popped separately.

Cross-dep compaction is not safe — each dep has its own `subquery_id` and
its own MTV history. Each dep gets its own `ActiveMove`.

### Querying Changes

`Querying.move_in_where_clause/5` currently receives
`views_before_move` and `views_after_move` maps. Replace those maps with a view
resolver that can provide values for a subquery ref at a logical time:

```elixir
values_for.(subquery_ref, time)
```

Initial implementation can adapt this resolver back into arrays at the SQL
boundary, preserving existing SQL generation behavior. A later optimization can
special-case the triggering subquery position and use only the changed values
for candidate selection when the DNF plan makes that safe.

This keeps the first implementation smaller while still removing long-lived
view copies.

### Failure Modes

If `MultiTimeView` is not ready for a subquery, shapes using that subquery must
stay in fallback routing. They must not be marked ready.

If a consumer dies while it pins an old time, `SubqueryProgressMonitor` must
release its registration via the process monitor. Otherwise compaction can be
blocked indefinitely.

If a dependency materializer is removed, `MultiTimeView.remove_subquery/1` must
remove the view and `SubqueryIndex` must remove the children and participants
associated with that subquery without scanning unrelated shapes.

If compaction falls behind, correctness is preserved but routing becomes more
conservative and histories grow. Add telemetry so this is visible.

### Telemetry

Add enough telemetry to prove or disprove the design:

- number of values per subquery
- number of retained histories per subquery
- max and average history length
- min/current logical time gap per subquery
- number of registered consumers per subquery
- number of child nodes per subquery group
- first-child synchronous seed duration
- shape removal duration
- transient SQL move-in array size

### Complexity Check

- **Is this the simplest approach?** No. The simplest immediate fix is adding a
  reverse index for shape-owned values or using tombstones. Those approaches do
  less architectural work, but they keep or increase the duplicated full-view
  memory that caused the problem. This proposal is more complex because it
  crosses the materializer, event handler, querying, and filter index
  boundaries, but it removes both major long-lived duplicate view pools.
- **What could we cut?** The first implementation can keep existing SQL array
  generation, materializing arrays only at query time. It can also postpone
  aggressive history encoding, background compaction tuning, and cross-handle
  subquery interning.
- **What's the 90/10 solution?** Implement `MultiTimeView`, serialized
  registration, per-consumer logical times, and shared child routing. Keep
  move-in SQL generation structurally the same by resolving values from the
  shared view at the SQL boundary. Add telemetry before optimizing the query
  format further.

## Open Questions

Unresolved questions that need further discussion or will be determined during
implementation:

| Question | Options | Resolution Path |
|----------|---------|-----------------|
| **How should `values(subquery_id, time)` expose large views?** | Materialized `MapSet`, stream, both | Start with query-local materialization for compatibility, then prototype streaming or chunked array construction if telemetry shows spikes. |
| **Where should per-subquery logical times live?** | In `SubqueryIndex` participant rows, in `SubqueryProgressMonitor`, or in consumer-owned state with callbacks | Decide during implementation. Exact membership checks need fast `shape_handle + subquery_ref -> {subquery_id, logical_time}` lookup, so `SubqueryIndex` is the likely owner. |
| **When should positive routing rows be removed after compaction?** | Opportunistically on read/write, periodic cleanup, immediate cleanup when min time advances | Implement opportunistic plus periodic cleanup first. Add immediate cleanup only if stale positive routes are expensive. |
| **Should long histories switch representation?** | Keep flat lists, switch to tuples/arrays after a threshold, or compact eagerly | Keep flat lists for v1 and add telemetry for max history length before adding another representation. |

## Definition of Success

### Primary Hypothesis

> We believe that implementing shared subquery logical-time views will enable
> the issue #4279 hypothesis: subquery indexing can become scalable for shape
> add/remove and memory use while preserving v1.6 subquery move correctness.
>
> We'll know we're right if shared subqueries no longer allocate full
> per-consumer dependency views in steady state, shape removal no longer scans
> value-keyed membership rows owned by unrelated shapes, and existing subquery
> move correctness tests continue to pass.
>
> We'll know we're wrong if retained histories grow without bound under normal
> consumer lag, move-in query memory still dominates production incidents, or
> the cross-subsystem complexity creates correctness regressions compared with
> the current per-consumer view model.

### Functional Requirements

| Requirement | Acceptance Criteria |
|-------------|---------------------|
| Shared subquery view | One `MultiTimeView` view exists per `subquery_id`, and steady-state consumers do not store full `MapSet` views. |
| Per-consumer per-subquery logical time | Each consumer can evaluate each subquery at that subquery's own logical time. |
| Correct registration | Consumer registration is serialized with the materializer and returns a current logical time whose view is ready. |
| Progress notification | Consumers call `notify_processed_up_to(time, subquery_id)` after finishing moves, and compaction uses the minimum required time. |
| Synchronous first child seed | First-time child creation seeds routing for the current view before removing fallback. |
| Positive routing correctness | Values that are members at any retained time route to the relevant child node. |
| Negated routing correctness | Negated groups route conservatively and filter with `member_at_all_times?/2`. |
| Shape removal scalability | Removing a shape follows participant and child rows, not all subquery values for unrelated shapes. |
| Move-in compatibility | Existing move-in SQL behavior can be produced from logical-time views without long-lived before/after `MapSet` copies. |
| Observability | Telemetry reports retained time gaps, history sizes, seed duration, and removal duration. |

### Learning Goals

1. Measure how large retained logical-time windows become under realistic
   consumer lag.
2. Measure whether transient move-in SQL arrays remain a material memory cost
   after removing long-lived view copies.
3. Determine whether flat list histories are sufficient or whether a threshold
   representation is needed.
4. Determine whether conservative positive routing creates measurable extra
   filter work before compaction catches up.

## Alternatives Considered

These alternatives are based on the discussion and rejected approaches in
PR #4280.

### Alternative 1: Add `shape_handle -> all values`

**Description:** Add a reverse index from each shape to the full set of values
it has inserted into `SubqueryIndex`.

**Why not:** This improves shape removal, but it adds another full per-shape
dependency view. It makes the removal path easier by increasing the same memory
duplication this RFC is trying to remove.

### Alternative 2: Tombstone Removed Shapes And Clean Later

**Description:** Mark removed shapes as tombstoned and clean their value-keyed
membership rows asynchronously.

**Why not:** This is useful as an emergency mitigation, but it is not a
structural memory fix. It leaves stale rows in the hot routing path and
requires liveness checks or cleanup debt elsewhere.

### Alternative 3: One Global Widened Filter

**Description:** Store one widened filter for each subquery and route every
value that might match any participant, relying on downstream exact filtering.

**Why not:** A slow or stalled consumer can keep the shared filter broad and
over-route work for every other participant. This preserves correctness, but it
can move cost from memory to sustained routing and filtering work.

### Alternative 4: Intern Full Dependency Views

**Description:** Deduplicate identical full dependency views by interning
`MapSet` values or equivalent view structures.

**Why not:** This handles exact equality at a point in time, but one-value
moves immediately create new views or require a second delta representation.
At that point the design becomes a versioned or sparse-delta view. Logical time
models that state directly.

### Alternative 5: Versioned Lazy Exception Clearing

**Description:** Keep sparse exceptions and clear or promote them lazily with
versions instead of doing eager cleanup.

**Why not:** This can reduce some hot-path work, but it adds versioning and
cleanup complexity while retaining a separate exception model. This is better
as a follow-up optimization if measurements show cleanup cost is high.

### Alternative 6: Shared Base View With Sparse XOR Exceptions

**Description:** The design in PR #4280 stores one base dependency view per
grouped subquery index entry and stores sparse per-participant XOR exceptions
for values where a participant temporarily differs from the base.

**Why not:** This is a lower-risk, index-focused approach and may still be the
right short-term fix if this RFC is too broad. However, it leaves consumer-held
before/after views in place and represents temporary divergence as
per-participant exceptions instead of as consumers reading different logical
times.
The logical-time design is a broader refactor, but it addresses the duplicated
state in both `SubqueryIndex` and consumer event handlers.

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.2 | 2026-05-18 | robacourt | Added operation examples, a memory prototype script, measured local memory scenarios, and customer-shaped estimates based on PR #4280 ratios. |
| 0.1 | 2026-05-18 | robacourt | Initial draft using the Stratovolt RFC template and alternatives from PR #4280. |

---

## RFC Quality Checklist

Before submitting for review, verify:

**Alignment**
- [x] RFC implements the working issue hypothesis, with no separate PRD.
- [x] API naming matches ElectricSQL conventions.
- [x] Success criteria link back to the issue hypothesis.

**Calibration for Level 1-2 PMF**
- [x] This is the smallest version of the logical-time design that validates
  the memory hypothesis.
- [x] Non-goals explicitly defer protocol changes, DNF redesign, and deeper
  query optimization.
- [x] Complexity Check section is filled out honestly.
- [x] An engineer could start implementing tomorrow.

**Completeness**
- [x] Happy path is clear.
- [x] Critical failure modes are addressed.
- [x] Open questions are acknowledged, not glossed over.
