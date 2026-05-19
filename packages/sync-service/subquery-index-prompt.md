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

Each subquery gets it's own shape. If the select statement differs at all we count it as a different subquery, even if the difference is just in a constant. So:
- SELECT id FROM users WHERE company_id=7
- SELECT id FROM users WHERE company_id=8
are two different subqueries and each get their own subquery_id (the handle for the subquery shape)

### Subquery Group

A subquery group is a set of subqueries that have the same field and polarity at a particular node in the filter tree.

So for example the two subqueries in the two shapes below are differnt subqueries (because they differ by the company_id constant) but they are in the same subquery group because they have the same field (user_id) and polarity (:positive) at the same node in the filter tree:
WHERE user_id IN (SELECT id FROM users WHERE company_id=7)
WHERE user_id IN (SELECT id FROM users WHERE company_id=8)

A subquery_id may appear in multiple subquery groups if it appears at multiple nodes in the filter tree. For the subquery is the same (has the same subquery_id) in the two shapes below but falls into different subquery groups because it appears at a differnt node in the filter tree:
WHERE user_id IN (SELECT id FROM users WHERE company_id=7)
WHERE project_id=4 AND user_id IN (SELECT id FROM users WHERE company_id=7)

## Goals

- Reduce memory footprint of subqueries significantly while remaining consitant and performant
- have near O(1) performance for:
    - subquery addition and removal, including subquery group addition and removal where needed
    - row processing by the where clause filter (so for afffected_shapes in the SubqueryIndex) even when there are thousands of subqueries in a subquery group
- Store one shared materialized view per subquery.
- Support exact membership reads at separate logical times.
- Preserve positive, negated, AND, OR, and NOT subquery correctness from v1.6.

## Non-Goals

- Do not change the client wire protocol.

## Proposal

### Components

#### SubqueryIndex.MultiTimeView

The MultiTimeView is an Materialized view of a subquery, queryable at multiple points in time.

It's implimented as an ETS table (one ETS table per stack_id)

subquery_id, value -> list(times)

the meaning of the result:
  doesn't exist - the value is not a member of the subquery for all logical times
  [] - the value is a member of the subquery for all logical times
  [:out, 9] - the value was out of the set before 9 and in the set from time 9 and above
  [:out, 9, 11] - the value was out of the set before 9 and in the set from 9 to 10 and out the set again from time 11 and above
  [:in, 9] - the value was in of the set before 9 and out the set from time 9 and above
  [:in, 9, 11] - the value was in of the set before 9 and out the set from 9 to 10 and in the set again from time 11 and above

note: the list(times) structure above has been chosen for memory efficientcy, but if you can think of a smaller structure let me know. for example if `[]` takes up more space than `true` then we should use `true` since this will be the most common case and we want to be memory efficient.

so for subquery_id, value - [:in, 9, 11]

member?(subquery_id, value, time: 8) = true
member?(subquery_id, value, time: 9) = false
member?(subquery_id, value, time: 10) = false
member?(subquery_id, value, time: 11) = true

rather than specifying a time you can also ask for membership across all times:

member_at_some_time?(subquery_id, value) = true
member_at_all_times?(subquery_id, value) = false

These are useful for the where clause filter which needs to keep the filter broad enough so that all consumers get all the changes they need while they may be at any of the logical times.

For each subquery there will be a minimum logical time needed (the minimum in-flight logical time for the subquery) which the SubqueryProgressMonitor will set on the MultiTimeView. This allows the MultiTimeViewETS table to be compacted for memory and performace efficientcy. For any given list(times) it can be compacted by removing times from before the minimum in-flight logical time, making sure to update the :in/:out marker at the beginning of the list appropriately or removing it if there are no times left.

Compacting should happen:
- when the list is read (e.g. when member? for the value is called)
- when the list is written to (e.g. when a value is moved in or out)
- when an async compaction routine is run (the design of this will need to be discussed)

Removing a subquery should not involve a full ETS table scan as this will be too slow with lots of subqueries. If the ETS table is orderd we should be able to find the first item for the subqery, delete that,  then find the next, and continue until the whole subquery is gone. That means it scales with the number of values (which is acceptable) rather than the number of subqueries.


#### SubqueryIndex

This is a complete re-write of the existing SubqueryIndex that delegates some of it's resposibility to the the MultiTimeView.

Since there may be many subqueries in a subquery group, the SubqueryIndex should keep:

subquery_group_id, value -> list(child_node_id)

where:
subquery_group_id is a number (whatever is smallest in memory) and represents {node_id, field, polarity} but to save memory (as it's going to be repeated lots in the ETS table) we keep it small and also store:
subquery_group_id -> {node_id, field, polarity} and
{node_id, field, polarity} -> subquery_group_id

and there's one child_node_id per subquery_id for the group. child_node_id is smaller in memory so we keep that in places where it's going to be repeated lots in the ETS table (e.g. in `subquery_group_id, value -> list(child_node_id)`)


So for `afffected_shapes` for a particular value, we'd look up the list of child_node_ids from the subquery_group_id, value pair then lookup the subquery_ids from the child_node_ids then for each subquery_id:

if MultiTimeView.member_at_some_time?(subquery_id, value) do
  WhereCondition.affected_shapes(child_node_id)
else
  MapSet.new()
end

For a given {subquery_id, :negative} pair the affected shaped will be:

if MultiTimeView.member_at_all_times?(subquery_id, value) do
  MapSet.new()
else
  WhereCondition.affected_shapes(child_node_id)
end

This will ensure that the rows are included for all available times.

If the MultiTimeView has not been marked ready by the Materializer yet, the SubqueryIndex should return WhereCondition.affected_shapes(child_node_id)

Removal of a subquery must not scale with the total number of shapes or the number of subqueries in the group, but can scale with the number of values for the subquery. This can be achived by getting the getting the values for the subquery from the MultiTimeView (as discussed above in the MultiTimeView section when talking about subquery removal) - whilst iterating though those values we can also delete those values in the SubqueryIndex for all the groups that it's in.

#### Materializer

This is the existing Materializer. It will just need to be updated to:
- populate the SubqueryIndex when the Materializer has initialised (it has a full materialized view). This should be at logical time 0.
- increment logical time for each `{:materializer_changes` message it sends to outer consumers, and include the new logical time in that message
- before the `{:materializer_changes` message is sent, the SubqueryIndex should be updated with the changes giving the new logical time as the time of the change

#### Logical Time

Logical Time is monotonically incrementing counter per subquery.

This needs to be a memory efficient data staructure that can be incremented indefinately. If it needs to wrap we need to make sure we use appropriate conparison functions when comparing times. Wrapping is an acceptable solution since there will only ever be so many moves in flight for any given subquery and memory would explode due to that before wrapping would cause comparison failures.

#### SubqueryProgressMonitor

This can be a separate process that the outer consumer calls to acknoledge that it's finished with a logical time for a subquery. The SubqueryProgressMonitor can then keep track of the minimum in-flight logical time for each subquery and set that on the MultiTimeView so that the MultiTimeView can compact it's ETS table for memory and performance efficientcy.

The SubqueryProgressMonitor can be implimented as an ETS table ordered by subquery_id then logical time with an index to where an outer shape_id entry is so that when an outer consumer acks a logical time for a subquery, the outer shape can be found in the the ordered list and removed and replaced with the acked time. The minimum of theses times is the minimum in-flight logical time for the subquery. This should mean that updating a outer shape's logical time is O(1) and reading the minimum in-flight logical time is O(1). The SubqueryProgressMonitor should notify the MultiTimeView when the minimum in-flight logical time for a subquery changes so that the MultiTimeView can compact it's ETS table.

The SubqueryProgressMonitor must know about all shapes for a subquery (so for example if it's not seen an ack from one of them it needs to know the minimum time is still 0) or a subquery and have those shapes removed

#### Consumer EventProcessors

These should be updated so that rather than holding views of the subquery, they just hold the logical time. so the before and after views should instead just be the before and after logical times.
- `convert_change` should have a function passed to it that access MultiTimeView.member? at the specified time
- the move-in query needs entire views at specific times and so should call MultiTimeView.get(time) and care should be made to not keep this in memory for too long, perhaps we should GC the consumer process afterwards, or perhaps the task process that runs the query should call MultiTimeView.get(time) so that the memory is freed when the process ends

### Concurrency model

Reads and writes to the MultiTimeView and SubqueryIndex ETS tables will mostly not be concurrent:
- add_shape and remove_shape will happen on the ShapeLogCollector process
- add_value and remove_value will happen while the ShapeLogCollector process is blocked so acts as if it were on the ShapeLogCollector process (ShapeLogCollector calls the Consumer which calls the Materializer which calls the SubqueryIndex to add/remove values, all synchronously)
- a Materializer seeding a subquery will happen when the Materializer is ready (so asyncronously to the ShapeLogCollector process) but will then call mark_ready on the SubqueryIndex which is an atomic process
- read of MultiTimeView may happen async by a consumer, but will be a read at a specific logical time so concurrentcy should not be an issue
- the mimimum in-flight logical time for a subquery will be updated by the SubqueryProgressMonitor async, but this will just update a single number, so concurrentcy should not be an issue

