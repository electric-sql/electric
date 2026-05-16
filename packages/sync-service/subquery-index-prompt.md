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

## Goals

- Reduce memory footprint of subqueries significantly while remaining consitant and performant
- have near O(1) performance for:
    - subquery addition and removal
    - row processing by the where clause filter (so for afffected_shapes in the SubqueryIndex)
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

This is a complete re-write of the existing SubqueryIndex that delegates most of it's resposibility to the the MultiTimeView.

When a shape is added to the SubqueryIndex at a particular node in the filter tree, SubqueryIndex will need to keep something like:

node_id, subquery_id, polarity -> child_node_id

and add the shape to the child WhereCondition node

When the SubqueryIndex is asked the affected_shapes for a given value, it will need to iterate through all {subquery_id, polarity} pairs it has and MapSet.union the affected shapes for each.

For a given {subquery_id, :positive} pair the affected shaped will be:

if MultiTimeView.member_at_some_time?(subquery_id, value) do
  WhereCondition.affected_shapes(node_id)
else
  MapSet.new()
end

For a given {subquery_id, :negative} pair the affected shaped will be:

if MultiTimeView.member_at_all_times?(subquery_id, value) do
  MapSet.new()
else
  WhereCondition.affected_shapes(node_id)
end

This will ensure that the rows are included for all available times

If the MultiTimeView has not been populated by the Materializer yet, the SubqueryIndex should return WhereCondition.affected_shapes(node_id)

#### Materializer

This is the existing Materializer. It will just need to be updated to:
- populate the MultiTimeView when the Materializer has initialised (it has a full materialized view). This should be at logical time 0.
- increment logical time for each `{:materializer_changes` message it sends to outer consumers, and include the new logical time in that message
- before the `{:materializer_changes` message is sent, the MultiTimeView should be updated with the changes giving the new logical time as the time of the change

#### Logical Time

Logical Time is monotonically incrementing counter per subquery. 

This needs to be a memory efficient data staructure that can be incremented indefinately. If it needs to wrap we need to make sure we use appropriate conparison functions when comparing times. Wrapping is an acceptable solution since there will only ever be so many moves in flight for any given subquery and memory would explode due to that before wrapping would cause comparison failures.

#### SubqueryProgressMonitor

Pin worked out from acks
-LRU algorithm 

#### Consumer EventProcessors

These should be updated so that rather than holding views of the subquery, they just hold the logical time. so the before and after views should instead just be the before and after logical times. 
- `convert_change` should have a function passed to it that access MultiTimeView.member? at the specified time  
- the move-in query needs entire views at specific times and so should call MultiTimeView.get(time) and care should be made to not keep this in memory for too long, perhaps we should GC the consumer process afterwards, or perhaps the task process that runs the query should call MultiTimeView.get(time) so that the memory is freed when the process ends


# The Problem With The Above Design

Subqueries have different subquery_ids even if they only differ in a constant, so:
- SELECT id FROM users WHERE company_id=7
- SELECT id FROM users WHERE company_id=8
are two different subqueries. If the SubqueryIndex iterates through {subquery_id, :positive} pairs that may be thousands of pairs and be too slow since it's in the replication stream hot path.

Instead we should, at each node, for each {field, polarity} pair, keep a reverse index for all the subqueries for that pair. So:
WHERE user_id IN (SELECT id FROM users WHERE company_id=7)
WHERE user_id IN (SELECT id FROM users WHERE company_id=8)

would be in the same reverse index because they have the same field (user_id) and polarity (:positive).

Perhaps the index could have the form:
subquery_cohort_id, value -> list({child_node_id, list(times)})

where:
subquery_cohort_id is a number (whatever is smallest in memory) and represents {node_id, field, polarity} but to save memory (as it's going to be repeated lots in the ETS table) we keep it small and also store:
subquery_cohort_id -> {node_id, field, polarity} and
{node_id, field, polarity} -> subquery_cohort_id

and there's one child_node_id per subquery_id for the cohort

Shape removal can be quick because we can keep track of subquery_id -> child_node_id and remove the shape from the child node, but removing nodes becomes slow since they're scattered throughout the ETS table. I suggest the cleaning up of nodes should be done asynchronously by a process that walks through the ETS table for nodes with no shapes and removes them. Race conditions can be avoided by doing an atomic conditional replace in the ETS table.
