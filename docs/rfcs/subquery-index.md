# Shared Subquery Views with Logical-Time Reads

## Summary

Electric v1.6 introduced per-shape subquery indexing so consumers can keep
boolean subquery shapes live while dependency rows move across `WHERE`
boundaries. That solved correctness, but it made memory scale with the number of
shape consumers. Each consumer can keep its own materialized dependency view in
the `SubqueryIndex`, and while move-ins are buffered it can also hold both a
before and after view.

This RFC proposes replacing per-consumer materialized subquery views with one
shared, versioned view per subquery. Consumers do not copy the view.
Instead, they read the shared view at a logical time.


## Background

Related implementation work:

- Commit: https://github.com/electric-sql/electric/commit/a04b25962cdb7ca86c4434585b6f74c758e1a31b
- PR: https://github.com/electric-sql/electric/pull/4051
- issue: https://github.com/electric-sql/electric/issues/4279
- Current index: `packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex`

The v1.6 work lets shapes with boolean combinations around subqueries remain
live when dependency rows move. The key correctness problem is that consumers can
temporarily disagree about a subquery's membership while one consumer has
processed a move and another has not.

The current implementation handles that by letting each shape consumer seed and
update exact per-shape membership rows. That keeps each consumer correct, but it
duplicates the same view across many shapes. During move-in buffering, the
consumer also carries before and after views so it can convert buffered
transactions and build the move-in query.

## Problem

The memory problem is broader than value-keyed routing rows in `SubqueryIndex`.
There are at least two duplicated memory pools:

1. `SubqueryIndex` membership and routing rows, currently keyed by shape.
2. Consumer/materializer views, including before and after views during active
   move-in buffering.

Adding a reverse index such as `shape_handle -> all values` would make removal
faster, but it would increase memory.

## Definitions

### Subquery

Each subquery gets its own shape. If the select statement differs at all we count it as a different subquery, even if the difference is just in a constant. So:
- SELECT id FROM users WHERE company_id=7
- SELECT id FROM users WHERE company_id=8
are two different subqueries and each get their own subquery_id (the handle for the subquery shape)

### Subquery Group

A subquery group is a set of subqueries that have the same field and polarity at a particular node in the filter tree.

So for example the two subqueries in the two shapes below are different subqueries (because they differ by the company_id constant) but they are in the same subquery group because they have the same field (user_id) and polarity (:positive) at the same node in the filter tree:
WHERE user_id IN (SELECT id FROM users WHERE company_id=7)
WHERE user_id IN (SELECT id FROM users WHERE company_id=8)

A subquery_id may appear in multiple subquery groups if it appears at multiple nodes in the filter tree. For example, the subquery is the same (has the same subquery_id) in the two shapes below but falls into different subquery groups because it appears at a different node in the filter tree:
WHERE user_id IN (SELECT id FROM users WHERE company_id=7)
WHERE project_id=4 AND user_id IN (SELECT id FROM users WHERE company_id=7)

## Goals

- Reduce memory footprint of subqueries significantly while remaining consistent and performant
- have near O(1) performance for:
    - subquery addition and removal, including subquery group addition and removal where needed
    - row processing by the where clause filter (so for affected_shapes in the SubqueryIndex) even when there are thousands of subqueries in a subquery group
- Store one shared materialized view per subquery.
- Support exact membership reads at separate logical times.
- Preserve positive, negated, AND, OR, and NOT subquery correctness from v1.6.

## Non-Goals

- Do not change the client wire protocol.

## Proposal

### Components

#### SubqueryIndex.MultiTimeView

The MultiTimeView is a materialized view of a subquery, queryable at multiple points in time.

It's implemented as an ETS table (one ETS table per stack_id)

subquery_id, value -> list(times)

the meaning of the result:
  doesn't exist - the value is not a member of the subquery at any retained logical time
  [] - the value is a member of the subquery at every retained logical time
  [:out, 9] - the value was out of the set before 9 and in the set from time 9 and above
  [:out, 9, 11] - the value was out of the set before 9 and in the set from 9 to 10 and out of the set again from time 11 and above
  [:in, 9] - the value was in the set before 9 and out of the set from time 9 and above
  [:in, 9, 11] - the value was in the set before 9 and out of the set from 9 to 10 and in the set again from time 11 and above

note: the list(times) structure above has been chosen for memory efficiency. `[]` represents the always-present case (the most common case) and is an immediate term on BEAM, so it adds no per-row overhead beyond the key itself.

so for subquery_id, value - [:in, 9, 11]

member?(subquery_id, value, time: 8) = true
member?(subquery_id, value, time: 9) = false
member?(subquery_id, value, time: 10) = false
member?(subquery_id, value, time: 11) = true

rather than specifying a time you can also ask for membership across all times:

member_at_some_time?(subquery_id, value) = true
member_at_all_times?(subquery_id, value) = false

These are useful for the where clause filter which needs to keep the filter broad enough so that all consumers get all the changes they need while they may be at any of the logical times.

For each subquery there will be a minimum logical time needed (the minimum in-flight logical time for the subquery) which the SubqueryProgressMonitor will set on the MultiTimeView. This allows the MultiTimeView ETS table to be compacted for memory and performance efficiency. For any given list(times) it can be compacted by removing times from before the minimum in-flight logical time, making sure to update the :in/:out marker at the beginning of the list appropriately or removing it if there are no times left.

Compacting should happen:
- when the list is read (e.g. when member? for the value is called)
- when the list is written to (e.g. when a value is moved in or out)
- when an async compaction routine is run (the design of this will need to be discussed)

Removing a subquery should not involve a full ETS table scan as this will be too slow with lots of subqueries. If the ETS table is ordered we should be able to find the first item for the subquery, delete that, then find the next, and continue until the whole subquery is gone. That means removal scales with the number of values in the subquery being removed, rather than the total size of the ETS table.


#### SubqueryIndex

This is a complete re-write of the existing SubqueryIndex that delegates some of its responsibility to the MultiTimeView.

Since there may be many subqueries in a subquery group, the SubqueryIndex should keep:

subquery_group_id, value -> list(child_node_id)

where:
subquery_group_id is a number (whatever is smallest in memory) and represents {node_id, field, polarity} but to save memory (as it's going to be repeated lots in the ETS table) we keep it small and also store:
subquery_group_id -> {node_id, field, polarity} and
{node_id, field, polarity} -> subquery_group_id

and there's one child_node_id per subquery_id for the group. child_node_id is smaller in memory so we keep that in places where it's going to be repeated lots in the ETS table (e.g. in `subquery_group_id, value -> list(child_node_id)`)

To support removal without a full table scan, also keep:

subquery_id -> list({subquery_group_id, child_node_id})

This gives the groups a subquery participates in (and its child node within each), which is needed by both the removal path below and the new-child seeding path above.


So for `affected_shapes` for a particular value, we'd look up the list of child_node_ids from the subquery_group_id, value pair then lookup the subquery_ids from the child_node_ids then for each subquery_id:

if MultiTimeView.member_at_some_time?(subquery_id, value) do
  WhereCondition.affected_shapes(child_node_id)
else
  MapSet.new()
end

For a given {subquery_id, :negative} pair the affected shapes will be:

if MultiTimeView.member_at_all_times?(subquery_id, value) do
  MapSet.new()
else
  WhereCondition.affected_shapes(child_node_id)
end

This will ensure that the rows are included for all available times.

If the MultiTimeView has not been marked ready by the Materializer yet, the SubqueryIndex should return WhereCondition.affected_shapes(child_node_id)

When a new child_node_id is created for `{subquery_group_id, subquery_id}` and the subquery is already ready, the routing rows for that group must be seeded synchronously by iterating `MultiTimeView.values(subquery_id, current_time)` and appending the new child_node_id to each `subquery_group_id, value -> list(child_node_id)` entry. The child must not be exposed to routing until this seed completes, otherwise routing will miss values that the new child should match.

Removal of a subquery must not scale with the total number of shapes or the number of subqueries in the group, but can scale with the number of values for the subquery. This can be achieved by reading `subquery_id -> list({subquery_group_id, child_node_id})` to find the groups the subquery participates in, then iterating its values from the MultiTimeView (as discussed above in the MultiTimeView section) and deleting the corresponding `subquery_group_id, value -> list(child_node_id)` entries in each of those groups.

#### Materializer

This is the existing Materializer. It will just need to be updated to:
- populate the SubqueryIndex when the Materializer has initialised (it has a full materialized view). This should be at logical time 0.
- increment logical time for each `:materializer_changes` message it sends to outer consumers, and include the new logical time in that message
- before the `:materializer_changes` message is sent, the SubqueryIndex should be updated with the changes giving the new logical time as the time of the change

#### Logical Time

Logical Time is a monotonically incrementing counter per subquery.

Use a normal BEAM integer. It auto-promotes to a bignum when needed, so wrapping is unnecessary.

#### SubqueryProgressMonitor

This can be a separate process that the outer consumer calls to acknowledge that it's finished with a logical time for a subquery. The SubqueryProgressMonitor can then keep track of the minimum in-flight logical time for each subquery and set that on the MultiTimeView so that the MultiTimeView can compact its ETS table for memory and performance efficiency.

The SubqueryProgressMonitor can be implemented as an ETS table ordered by subquery_id then logical time with an index to where an outer shape_id entry is so that when an outer consumer acks a logical time for a subquery, the outer shape can be found in the ordered list and removed and replaced with the acked time. The minimum of these times is the minimum in-flight logical time for the subquery. This should mean that updating an outer shape's logical time is O(1) and reading the minimum in-flight logical time is O(1). The SubqueryProgressMonitor should notify the MultiTimeView when the minimum in-flight logical time for a subquery changes so that the MultiTimeView can compact its ETS table.

The SubqueryProgressMonitor must know about every shape that reads a subquery, so that if it hasn't yet seen an ack from one of them it knows the minimum in-flight time is still 0. It must also be notified when a shape or a subquery is removed, so that the corresponding entries are cleaned up and stale entries don't hold the minimum back indefinitely.

##### Registration

A consumer is added to the SubqueryProgressMonitor as part of the existing materializer subscribe call. That call captures `current_time` and adds the consumer to the materializer's subscribers list in a single `handle_call`; the monitor registration must happen inside that same `handle_call` (a synchronous call from the materializer to the monitor) before it returns, with `required_time = current_time`.

This sequencing matters. If the monitor were registered in a separate call after subscribing, another consumer could ack and move the minimum past `current_time` before the monitor knew the new consumer existed, allowing MTV to compact away time `current_time` while the new consumer still needs it. Equally, if subscribing and capturing `current_time` were split across two materializer calls, the materializer could commit between them and the new consumer's first observed `materializer_changes` would have `from_time > current_time`, breaking the invariant that `MTV(consumer.time)` reflects what the consumer has processed.

#### Consumer EventProcessors

These should be updated so that rather than holding views of the subquery, they just hold the logical time. So the before and after views should instead just be the before and after logical times.
- `convert_change` should have a function passed to it that accesses MultiTimeView.member? at the specified time
- the move-in query needs entire views at specific times and so should call MultiTimeView.values(subquery_id, time) and care should be made to not keep this in memory for too long, perhaps we should GC the consumer process afterwards, or perhaps the task process that runs the query should call MultiTimeView.values(subquery_id, time) so that the memory is freed when the process ends

#### MoveQueue

The Materializer emits `:materializer_changes` messages carrying changed values for a subquery at a new logical time. The consumer's MoveQueue buffers these and yields combined batches one at a time.

A batch covers a contiguous logical-time window `[a, b]` for a single subquery and carries both move-in and move-out values:

```elixir
%{
  subquery_id: s7,
  from_time: a,
  to_time: b,
  move_in_values:  [...],
  move_out_values: [...]
}
```

By construction `MTV(b) = MTV(a) + move_in_values - move_out_values`. The ins and outs are kept together because times in MTV are points in a totally ordered history per subquery — there is no intermediate time at which only the move-outs of `[a, b]` have been applied.

##### Compaction rules

Per subquery within `[a, b]`, sequences of moves compact into a single `(move_in_values, move_out_values)` pair as long as the net effect preserves `MTV(b) = MTV(a) + ins - outs`:

- repeated adds of the same value collapse to one
- repeated removes of the same value collapse to one
- `add V` then `remove V` cancel
- `remove V` then `add V` cancel
- adds and removes for disjoint values are kept

Each subquery is compacted independently — moves for subquery A do not affect the contiguous window for subquery B.

##### Splice plan ordering

When the consumer applies a batch, the effects must be emitted in this order:

1. `pre_ops` — buffered transactions from the `[a, b]` window, evaluated at `MTV(a)`
2. move-out broadcast for outer move-out values (may be empty)
3. move-in broadcast for outer move-in values (may be empty)
4. snapshot rows from the move-in query
5. `post_ops` — buffered transactions after the snapshot, evaluated at `MTV(b)`

The reason `pre_ops` must come before the move-out broadcast is that a buffered transaction may reference a value that is about to be moved out. Evaluated at `MTV(a)` the row is still a member, so the buffered txn surfaces to the client as an `UPDATE`; the subsequent move-out broadcast then emits the `DELETE`. The client sees `UPDATE then DELETE`. If the order were reversed, the client would see `DELETE then UPDATE` — an update for a row it no longer has.

For a pure move-out batch (no move-in values, so no PG query is needed) the consumer can skip the snapshot step and broadcast the move-out inline before advancing to `b`.

### Concurrency model

Reads and writes to the MultiTimeView and SubqueryIndex ETS tables will mostly not be concurrent:
- add_shape and remove_shape will happen on the ShapeLogCollector process
- add_value and remove_value will happen while the ShapeLogCollector process is blocked so acts as if it were on the ShapeLogCollector process (ShapeLogCollector calls the Consumer which calls the Materializer which calls the SubqueryIndex to add/remove values, all synchronously)
- a Materializer seeding a subquery will happen when the Materializer is ready (so asynchronously to the ShapeLogCollector process) but will then call mark_ready on the SubqueryIndex which is an atomic process
- read of MultiTimeView may happen async by a consumer, but will be a read at a specific logical time so concurrency should not be an issue
- the minimum in-flight logical time for a subquery will be updated by the SubqueryProgressMonitor async, but this will just update a single number, so concurrency should not be an issue

## Operations

Every operation the design needs to support, with cost and where it runs relative to the ShapeLogCollector (SLC). Context values:

- **SLC** — runs on the SLC process
- **blocked SLC** — runs on another process while SLC is synchronously waiting for it
- **async** — runs independently of SLC

### Routing (hot path, per WAL record)

| Operation                                                | Cost                                                              | Context           |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ----------------- |
| `affected_shapes(value)` for a positive group            | O(children_for_value + child_where_eval)                          | SLC               |
| `affected_shapes(value)` for a negated group             | O(negated_children_in_group × history_length + child_where_eval)  | SLC               |
| `member?(subquery_id, value, time)` from `convert_change`| O(history_length_for_value)                                       | async (consumer)  |

### Subquery and group lifecycle

| Operation                                                | Cost                                                                                | Context                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Subquery group addition (first occurrence at filter node)| O(1)                                                                                | SLC (during `add_shape`)                             |
| Subquery group removal (last child removed)              | O(1)                                                                                | SLC (during `remove_shape`)                          |
| `mark_ready(subquery_id)` after initial materialization  | O(1), atomic                                                                        | async                                                |
| `remove_subquery(subquery_id)`                           | O(values_in_subquery + children_for_subquery + Σ shapes_per_child)                  | async (driven by dependency shape lifecycle)         |

### Shape lifecycle

| Operation                                                | Cost                                                                                              | Context                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `add_shape` onto an existing child                       | O(participants_for_shape)                                                                         | SLC                                      |
| `add_shape` creating a new child, MTV ready              | O(values_in_subquery + participants_for_shape) — seed runs synchronously before child is exposed  | blocked SLC                              |
| `add_shape` creating a new child, MTV not ready          | O(1) to attach to fallback; seeding runs when MTV becomes ready                                   | SLC, then async seed                     |
| `add_shape` for a previously-unseen subquery             | dependency materializer startup + initial population (not O(1)), then as above                    | async setup, blocked SLC for the seed    |
| Consumer registration (consumer setup, before `add_shape`)| O(1) inside the materializer's subscribe `handle_call`                                           | async to SLC (consumer process blocked)  |
| `remove_shape`, other shapes remain on the child         | O(participants_for_shape)                                                                         | SLC                                      |
| `remove_shape`, last shape on the child                  | O(values_in_subquery + child_metadata)                                                            | SLC                                      |

### Value changes (materializer-driven)

| Operation                                                | Cost                                                                       | Context                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `add_value` / `remove_value`                             | O(changed_values × positive_children_for_subquery + history_update)        | blocked SLC (SLC → Consumer → Materializer → SubqueryIndex)      |
| `values(subquery_id, time)` for a synchronous seed       | O(values_in_subquery × history_eval)                                       | blocked SLC                                                      |
| `values(subquery_id, time)` for a move-in query          | O(values_in_subquery × history_eval)                                       | async (consumer's query task)                                    |

### Progress and compaction

| Operation                                                | Cost                                                              | Context                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `notify_processed_up_to(time, subquery_id)`              | O(1) update + O(1) or O(log consumers) min recompute              | async (consumer → monitor)               |
| Compaction triggered by min advance                      | incremental, O(values_touched + stale_routes_removed)             | async                                    |
| Opportunistic compaction at read/write                   | O(history_length_for_value)                                       | wherever the read/write runs             |
| Consumer death releasing pinned times                    | O(subqueries_consumer_reads) via process monitor                  | async                                    |

