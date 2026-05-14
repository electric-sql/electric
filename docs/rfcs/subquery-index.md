---
title: Shared SubqueryIndex Base View with Sparse XOR Exceptions
version: "0.6"
status: draft
owner: robacourt
contributors: []
created: 2026-05-06
last_updated: 2026-05-14
prd: N/A - based on https://github.com/electric-sql/electric/issues/4279
prd_version: N/A
---

# Shared SubqueryIndex Base View with Sparse XOR Exceptions

## Summary

Electric v1.6 introduced per-shape subquery indexing so each shape consumer could maintain the exact dependency view it needed while subquery rows moved across boolean `WHERE` clauses. That preserved correctness, but it made the index memory-inefficient: in the common case many shapes have the same dependency view, yet the index stores that view once per shape.

Shape removal now needs to clean up per-shape index entries and has been observed to block replication processing and cause WAL lag.

This RFC proposes replacing full per-shape subquery membership with one shared base view per subquery index cohort plus sparse per-participant XOR exceptions for the short windows where consumers are out of sync.

The target outcome is:

- removal cost proportional to a shape's subquery participants, routing edges, and outstanding exceptions, not to total shapes or the shape's full dependency view;
- whole-subquery/cohort teardown cost proportional to affected cohorts, participants, routing edges, and exceptions, not to total shapes;
- steady-state memory closer to `O(V + P + R + C)` than `O(P * V)`;
- the same correctness guarantees for positive and negated subqueries during dependency moves.

## Background

Issue: https://github.com/electric-sql/electric/issues/4279

Related implementation work:

- Commit: https://github.com/electric-sql/electric/commit/a04b25962cdb7ca86c4434585b6f74c758e1a31b
- PR: https://github.com/electric-sql/electric/pull/4051
- Current `SubqueryIndex`: https://github.com/electric-sql/electric/blob/main/packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex

The v1.6 subquery work allowed shapes with boolean combinations around subqueries to stay live when dependency rows move, instead of invalidating the shape and forcing a full resync. The core architectural change was that each shape consumer seeds and updates a shared reverse index from its own local dependency view.

That local-view ownership is important for correctness during moves. While one consumer has processed a move and another has not, the two consumers can temporarily have different views of the same subquery. The current index represents that by storing exact per-shape membership.

The relevant current shape of the index is approximately:

```text
positive routing:
  {node_id, value} -> {shape_handle, next_condition_id}

negated routing:
  node_id -> all negated shape handles
  {node_id, value} -> negated shape handles whose local dependency view contains value

exact membership:
  {shape_handle, subquery_ref, value} -> true
```

The useful property is that routing can answer "which shapes might be affected by this root-table value?" quickly. The problematic property is that shape membership is represented by many per-shape rows, so removing a shape requires finding and deleting rows for that shape from a value-keyed index.

## Problem

Removing a shape from the current SubqueryIndex is O(n) in the number of indexed shapes and has been observed to block replication processing. Since replication processing is on the path that prevents WAL lag, slow shape removal can create production impact.

The same class of failure would remain if the new design made single-shape removal cheap but left whole-subquery teardown discoverable only by scanning all shape-owned participant rows. Removing a subquery, dependency, or cohort must not be implemented as "iterate every shape and ask whether it uses this subquery." That would make the worst case O(total shapes) even when only a small subset is affected, and would move the current production risk to a different lifecycle path.

The narrow fix would be to add a reverse index:

```text
shape_handle -> all indexed values for that shape
```

That would improve removal, but it would increase memory use for a structure that is already memory inefficient.

The wider design problem is that the current implementation optimizes for the exceptional case -- each shape consumer can have a distinct dependency view -- by paying the cost all the time. In practice, most consumers using the same subquery index cohort should have the same dependency view most of the time. They usually diverge only during subquery moves.

At a high level:

| Concern | Current index | Proposed index |
|---------|---------------|----------------|
| Shared dependency view | Stored once per shape | Stored once per cohort |
| Temporary divergence | Full per-shape view | Sparse exceptions only |
| Shape removal | Scan value-keyed membership rows | Follow participant reverse index plus sparse exceptions |
| Steady-state memory | `O(P * V)` | `O(V + P + R + C)` |
| Move handling correctness | Exact | Exact |

**Link to PRD hypothesis:** There is no PRD for this RFC. The working hypothesis comes from issue #4279:

> Redesigning the SubqueryIndex so it does not store full per-shape dependency views will make shape add/remove scalable and reduce memory consumption, while preserving v1.6 subquery move correctness.

## Goals & Non-Goals

### Goals

- Make shape removal independent of the total number of shapes in the SubqueryIndex.
- Make shape removal independent of the number of values in the shape's normal, non-divergent dependency view.
- Make whole-subquery/cohort removal independent of the total number of shapes in the SubqueryIndex.
- Reduce memory use when many shapes share the same subquery dependency view.
- Preserve exact correctness for positive and negated subqueries during move-in and move-out handling.
- Preserve support for DNF-based routing and `active_conditions` introduced by the v1.6 subquery work.
- Avoid tombstones, generations, and move epochs in the initial design.
- Keep the existing fallback routing behavior for participants that are registered but not yet safely indexed.
- Add enough telemetry to verify memory savings, exception growth, and shape removal latency.

### Non-Goals

- Do not change the client wire protocol.
- Do not redesign DNF planning, `active_conditions`, move broadcasts, or materializer semantics.
- Do not solve the separate invalidation trigger that causes shapes to be removed.
- Do not deduplicate every identical subquery view across the whole service in the first implementation. The first implementation may use a conservative cohort boundary.
- Do not guarantee strict mathematical O(1) removal if a shape has a very large number of outstanding exceptions. The target is O(P + R + E), where `P` is the number of subquery participants for the shape, `R` is their routing edges, and `E` is their outstanding sparse exceptions.
- Do not guarantee O(1) removal of a whole subquery if many shapes genuinely participate in that subquery. The target is O(C + P_s + R_s + E_s) on the critical path, where `C` is affected cohorts, `P_s` is affected participants, `R_s` is their routing edges, and `E_s` is their outstanding sparse exceptions.
- Do not introduce tombstones, generations, or lazy exception clearing unless measurements show they are needed. Empty cohort base cleanup is allowed to run off the replication-critical path.

## Proposal

### Core idea

Represent the common dependency view once, and represent only the temporary differences per participant.

This section describes the logical model. The later data model section describes the compact ETS layout that implements it efficiently.

For each subquery index cohort:

```text
base_member[cohort, value] = true | absent
exception[cohort, value, participant] = true | absent
```

An exception means:

```text
this participant's local dependency membership for this value is the opposite of the shared base
```

So exact local dependency membership is:

```text
local_member?(participant, cohort, value) =
  base_member?(cohort, value) XOR exception?(cohort, value, participant)
```

This makes move-in and move-out symmetrical.

If the base says a value is absent and a participant sees a move-in, add an exception for that participant. If the cohort has exactly one indexed participant, compact that exception immediately by flipping the base.

If the base says a value is present and a participant sees a move-out, add an exception for that participant. Again, immediate base promotion is safe for a one-participant cohort.

For multi-participant cohorts, promotion is not part of the initial hot path. The exception rows remain the correctness representation until a later compaction path can prove that promoting the base cannot race independently processed consumer moves.

The index does not need to know whether a change came from move-in, move-out, broadening, narrowing, repair, or reseeding. It only needs a state-based operation:

```text
set_membership(participant, cohort, value, desired_local_member?)
```

### Terminology

#### Cohort

A cohort is the unit that shares a base dependency view.

For the first implementation, a cohort should include only participants whose
steady-state dependency membership is represented by the same dependency shape.
In the current architecture, the dependency shape handle is the best runtime
identity for that:

```text
cohort_key = {:dependency_shape, dependency_shape_handle}
```

When a dependency handle is unavailable, such as in narrow unit tests, use a
shape-local fallback key:

```text
cohort_key = {:shape_local_dependency, shape_handle, dep_index}
```

The important rule is:

```text
if two participants can have different steady-state dependency views for reasons other than temporary move ordering, they must not share a cohort
```

Later versions can intern cohorts more aggressively across equivalent dependency
plans that have different handles, but that is not required for this RFC.

The important implementation detail is that the logical cohort identity should be
interned to a compact runtime identifier. Hot ETS rows should store a small
integer `cohort_id`, not the full cohort key.

#### Participant and routing edge

A participant is a shape's local view of one subquery dependency. A routing
edge is a shape's position in a concrete subquery filter node.

The current index stores rows involving:

```text
shape_handle
node_id
dep_index
polarity
next_condition_id
branch_key
```

The new design should keep those concerns separate. Sparse exceptions belong to
the participant because exact dependency membership is per shape/dependency.
Routing metadata belongs to the edge because one participant can be used by
multiple filter-node positions, for example:

```sql
id IN (SELECT id FROM parent) OR par_id IN (SELECT id FROM parent)
```

In that case the shape should not duplicate exception rows for the same
dependency view. It should have one participant and two routing edges.

Conceptually:

```text
participant = {
  shape_handle,
  cohort_id,
  subquery_ref,
  dep_index,
  polarity
}

routing_edge = {
  participant_id,
  node_id,
  cohort_id,
  polarity,
  next_condition_id,
  branch_key
}
```

As with cohorts, hot ETS rows should store compact small integer
`participant_id` and `cohort_id` values rather than the full logical tuples.

### Data model

The first draft of this RFC used a tag-heavy conceptual ETS layout with rows like:

```text
{{:participants, cohort_id, :positive}, participant} -> true
{{:exception_by_value, cohort_id, value}, participant} -> true
```

Local ETS measurements on OTP 28 showed that this layout gives back too much of the memory win because it repeats atoms, nested key tuples, and full participant tuples in hot rows. The implementation should therefore use dedicated tables and interned small integer ids.

Recommended hot-path ETS layout:

```text
# Participant metadata, stored once per participant.
# Exact fields can vary, but lifecycle teardown needs at least the shape,
# cohort, local subquery ref, dependency index, polarity, and whether the
# participant is indexed or still in fallback.
participant_meta:
  {participant_id, shape_handle, cohort_id, subquery_ref, dep_index,
   polarity, readiness}

# Short-lived per-cohort writer/read coordination.
cohort_locks:
  {cohort_id, owner_pid}

# Cohort metadata, stored once per cohort.
cohort_meta:
  {cohort_id, cohort_key, subquery_key, lifecycle_state}

# Interning lookup for the logical cohort key.
# This should be keyed by dependency shape handle when available, falling back
# to a shape-local dependency key only when no dependency handle exists.
cohort_by_key:
  {cohort_key, cohort_id}

# Route from a filter node to the cohorts that can affect that node.
# This is required because routing starts with {condition_id, field_key}, not
# with a cohort id.
cohorts_by_node:
  {node_id, cohort_id}

# Node metadata used to evaluate the root-table value at a subquery node.
node_meta:
  {node_id, testexpr}

# Positive routing edges.
# `next_condition_id` is inlined so routing does not need an extra lookup.
positive_edges:
  {{node_id, cohort_id}, participant_id, next_condition_id}

# Negated routing edges.
negated_edges:
  {{node_id, cohort_id}, participant_id, next_condition_id}

# Reverse lookup for removing a participant's routing edges without scanning
# edge tables by non-key fields.
edges_by_participant:
  {participant_id, node_id, cohort_id, polarity, next_condition_id, branch_key}

# Reverse lookup for removal.
# `polarity` tells removal which participant table to touch.
participants_by_shape:
  {shape_handle, participant_id, cohort_id, polarity}

# Reverse lookup for whole cohort teardown.
# This must include participants that are still in fallback, not only indexed
# participants counted in `participant_count`.
participants_by_cohort:
  {cohort_id, participant_id}

# Reverse lookup for whole subquery/dependency teardown.
# `subquery_key` is the lifecycle identity that can be invalidated as a unit,
# such as a dependency shape handle plus the canonical subquery occurrence.
# It must not be a merely shape-local `$sublink` ref unless that ref is made
# globally unique by the surrounding key.
cohorts_by_subquery:
  {subquery_key, cohort_id}

# Exact membership lookup for `member?(shape_handle, subquery_ref, value)`.
# This points to the membership participant, not to every routing edge.
shape_ref_participant:
  {{shape_handle, subquery_ref}, participant_id, cohort_id}

# Count of indexed participants in a cohort.
# This excludes fallback participants that are not yet safely represented by base + exceptions.
participant_count:
  {cohort_id, non_neg_integer}

# Shared base membership plus the current sparse exception count for that value.
# If the row is absent, the base is false and the exception count is zero.
cohort_value:
  {{cohort_id, value}, base_member?, exception_count}

# Sparse exceptions by value, used during routing and promotion.
exception_by_value:
  {{cohort_id, value}, participant_id}

# Sparse exceptions by participant, used during shape removal.
exception_by_participant:
  {participant_id, cohort_id, value}

# Existing conservative fallback routing remains unchanged.
node_fallback:
  {{:node_fallback, node_id}, {shape_handle, next_condition_id}}
```

Lifecycle indexes must be keyed by the lifecycle dimension they serve. For ETS,
that means tables that need multiple rows per `shape_handle`, `cohort_id`, or
`subquery_key` should use a table type and key position that allow direct lookup
by that value. The implementation must not rely on `match_delete` or `select`
over non-key fields for shape, cohort, or subquery teardown, because that would
turn lifecycle cleanup back into a global table scan.

This keeps the value reverse index intentionally sparse:

```text
participant_id -> outstanding exception values only
```

It is not the rejected memory-heavy reverse index:

```text
shape_handle -> all values in the full dependency view
```

It also removes an avoidable constant factor from the proposed design itself. On the local benchmark described below, the compact layout above used 23-33% less ETS memory than the earlier tagged layout while preserving the same `O(V + P + R + C + E)` asymptotic shape.

The pseudocode below continues to use logical operations like `base_member?(cohort, value)` and `exception_count(cohort, value)`. In the compact layout those can be implemented from the `cohort_value` row rather than from separate ETS objects.

### Membership operation

All add/remove updates from shape consumers can be expressed as `set_membership/4`.

```text
set_membership(participant, cohort, value, desired_local_member?):
  base = base_member?(cohort, value)
  has_exception = exception?(cohort, value, participant)
  current = base XOR has_exception

  if current == desired_local_member?:
    return :ok

  if has_exception:
    delete_exception(participant, cohort, value)
  else:
    insert_exception(participant, cohort, value)

  maybe_promote(cohort, value)
```

Existing public operations can remain as wrappers:

```text
add_value(shape_handle, subquery_ref, dep_index, value)
  -> set_membership(participant, cohort, value, true)

remove_value(shape_handle, subquery_ref, dep_index, value)
  -> set_membership(participant, cohort, value, false)
```

This operation is idempotent. Replaying an add for a value that the participant already sees as present is a no-op. Replaying a remove for a value that the participant already sees as absent is a no-op.

### Promotion

Promotion is compaction, not correctness.

If one indexed participant exists in a cohort and it has an exception for a value, the base can be compacted immediately by flipping it and clearing the exception:

```text
maybe_promote(cohort, value):
  if exception_count(cohort, value) == participant_count(cohort)
     and participant_count(cohort) == 1:
    if base_member?(cohort, value):
      delete base_member(cohort, value)
    else:
      insert base_member(cohort, value)

    for participant in exception_by_value(cohort, value):
      delete exception_by_participant(participant, cohort, value)
      delete exception_by_value(cohort, value, participant)

    delete exception_count(cohort, value)
```

The initial implementation should physically clear exceptions during this one-participant promotion. This avoids generations or versions in the core design.

Promotion is O(number of exceptions for that value). In the initial implementation this is O(1), because promotion only runs when the cohort has one indexed participant.

Cross-participant promotion is intentionally deferred. It is a compaction optimization, not a correctness requirement, and promoting a shared base while consumers process moves independently can create incorrect routing if the implementation gets the synchronization boundary wrong. A later optimization may add a dedicated compactor with stronger synchronization, or versioned lazy clearing if promotion-time clearing becomes expensive.

### Routing

Routing starts from the current filter node, evaluates the root-table value,
then enumerates `cohorts_by_node(node_id)`. For each cohort it uses the same
`local_member = base XOR exception` idea, but computes matching routing edges in
bulk.

For positive subquery edges at a node:

```text
if base_member?(cohort, value):
  matching_positive = positive_edges(node_id, cohort)
                    - edges_for_exceptions(node_id, cohort, value, :positive)
else:
  matching_positive = edges_for_exceptions(node_id, cohort, value, :positive)
```

For negated subquery edges at a node:

```text
if base_member?(cohort, value):
  matching_negated = edges_for_exceptions(node_id, cohort, value, :negated)
else:
  matching_negated = negated_edges(node_id, cohort)
                   - edges_for_exceptions(node_id, cohort, value, :negated)
```

Then fallback routing edges are unioned in, as today:

```text
candidates = matching_positive
           + matching_negated
           + fallback_participants(node_id)
```

Each candidate continues through `WhereCondition.affected_shapes/3` using its `next_condition_id`, preserving the current DNF branch behavior.

### Truth table

The raw dependency membership table is simple:

| Base contains value? | Participant has exception? | Participant local dependency membership |
|----------------------|----------------------------|-----------------------------------------|
| false | false | false |
| false | true  | true  |
| true  | false | true  |
| true  | true  | false |

Polarity is applied after this:

| Participant polarity | Local dependency membership | Participant matches subquery condition? |
|----------------------|-----------------------------|-----------------------------------------|
| positive | true  | true  |
| positive | false | false |
| negated  | true  | false |
| negated  | false | true  |

### Shape registration and readiness

A newly registered participant should not be counted as an indexed participant until it is safe to represent it as `base + sparse exceptions`.

Before that point, it remains in fallback routing, as today.

Registration has two layers:

1. `register_shape` creates one membership participant per canonical subquery
   dependency and records `shape_ref_participant` for exact evaluation.
2. `add_shape` creates routing edges for concrete optimized subquery nodes.

The common-case readiness path should be:

1. Register participant metadata.
2. Add participant reverse rows for shape, cohort, and subquery lifecycle lookup.
3. Add routing edge reverse rows for any optimized subquery node positions.
4. Seed the participant's exact local view.
5. Attach it to the cohort base either by initializing the base, adopting an
   equivalent base, or storing the sparse diff from the base.
6. Increment `participant_count`.
7. Remove the participant from fallback once all participants for the shape are
   ready.

Seeding can be O(number of values in the dependency view), as it is today. The
important bounded path is shape removal: once seeded, the participant does not
own a full copy of the dependency view, only sparse exceptions.

An O(number of participants) readiness path is only valid when the
implementation can prove that the participant's local view equals the cohort
base without comparing value sets. In the current architecture, dependency shape
handle equality gives a safe cohort key, but it does not by itself prove that a
consumer starting during an active move can adopt the current base with no
exceptions.

If a participant starts while a move is in progress, or if it cannot prove that its local dependency view equals the cohort base, it must stay in fallback until one of these is true:

- It can adopt the base safely.
- It can seed the exact sparse diff from the base.
- The cohort is rebuilt or compacted.
- The implementation chooses a separate cohort for it.

This is an important correctness boundary. Joining a participant with no exceptions asserts that its local view equals the base. The implementation must not make that assertion unless it is true.

### Shape removal

Shape removal deletes participant metadata and any sparse exceptions owned by those participants. It does not delete the shape's full dependency view because that full view is not stored per shape.

```text
remove_shape(shape_handle):
  for participant in participants_by_shape(shape_handle):
    remove_participant(participant)

  remove fallback rows for shape_handle

remove_participant(participant):
  meta = participant_meta(participant)
  {shape_handle, cohort, subquery_ref, polarity} =
    {meta.shape_handle, meta.cohort, meta.subquery_ref, meta.polarity}

  for edge in edges_by_participant(participant):
    remove edge from positive_edges/negated_edges
    remove node fallback row for edge if present
    delete edge reverse row

  if meta.readiness == :indexed:
    decrement participant_count(cohort)

  remove participant from participants_by_shape(shape_handle)
  remove participant from participants_by_cohort(cohort)
  remove shape_ref_participant(shape_handle, subquery_ref, participant)
  remove fallback row for participant if present

  for {cohort, value} in exception_by_participant(participant):
    delete exception_by_value(cohort, value, participant)
    delete exception_by_participant(participant, cohort, value)
    decrement exception_count(cohort, value)
    maybe_promote(cohort, value)  # optional for touched values only

  delete participant metadata
```

Complexity:

```text
O(P + R + E)
```

where:

```text
P = number of indexed or fallback subquery participants owned by the shape
R = number of routing edges owned by those participants
E = number of outstanding exception rows owned by those participants
```

More precisely the removal path is `O(P + R + E)`. In the common case, `E = 0`,
so removal is proportional only to the number of subquery dependencies and
filter-node positions in the shape, not to the number of values in the
dependency view.

### Subquery/cohort removal

Whole-subquery teardown is a separate lifecycle operation from single-shape removal. It must be driven from subquery/cohort reverse indexes, not from a scan of all shapes.

```text
remove_subquery(subquery_key):
  for cohort in cohorts_by_subquery(subquery_key):
    remove_cohort(cohort)

  delete any remaining cohorts_by_subquery(subquery_key)

remove_cohort(cohort):
  meta = cohort_meta(cohort)
  detach cohort from routing and new participant registration

  for participant in participants_by_cohort(cohort):
    remove_participant(participant)

  delete cohorts_by_subquery(meta.subquery_key, cohort)
  delete participant_count(cohort)
  delete cohort metadata
  enqueue_base_cleanup(cohort)
```

Complexity on the replication-critical path:

```text
O(C + P_s + R_s + E_s)
```

where:

```text
C = number of cohorts for the subquery lifecycle key
P_s = number of indexed or fallback participants in those cohorts
R_s = number of routing edges owned by those participants
E_s = number of outstanding exception rows owned by those participants
```

There must be no dependency on total shapes in the system. If a subquery genuinely has every shape as a participant, the cost is unavoidably proportional to affected participants; that is different from scanning unrelated shapes to discover the affected set.

Base membership cleanup remains off the critical path. `enqueue_base_cleanup(cohort)` may eventually reclaim `O(V_s)` values for the removed cohort, but routing must be detached before that work and the cleanup must be bounded, asynchronous, or table-drop based.

Shape invalidation orchestration can still remove the affected shapes separately. It should get the affected shape handles from the same participant enumeration used above, rather than rediscovering them by scanning all shapes.

### Empty cohort cleanup

When the last indexed participant leaves a cohort, the base membership for that cohort is no longer needed. The implementation must avoid deleting a large base view synchronously on the shape removal path.

Acceptable approaches:

1. Store base membership in a cohort-owned ETS table or owner process so the cohort can be detached from routing immediately and reclaimed off the replication-critical path.
2. Keep base membership in shared ETS tables but enqueue bounded cleanup for empty cohorts.
3. Maintain a cohort lifecycle manager that can drop or recycle empty cohorts without scanning the global SubqueryIndex.

This is not a tombstone for removed shapes. Removed participants are deleted exactly. The only deferred work is optional storage reclamation for an unreferenced cohort base.

### No tombstones in the initial design

The initial design should not use tombstones for participant removal.

Tombstones would be useful if we wanted removal to mark a participant inactive while leaving many participant-owned rows behind. This design should not need that because participant-owned rows are sparse exceptions, not full dependency views.

Routing should not need to check dead-shape tombstones to remain correct. Removed participants should be removed from participant sets and fallback sets.

If a pathological workload creates many outstanding exceptions for a participant and strict removal latency becomes more important than immediate exception cleanup, a later version can add inactive-participant tombstones. That is explicitly deferred.

### No generations or move epochs in the initial design

The initial design should not use generations or move epochs.

Generations or versions are useful only if promotion wants to flip the base in O(1) and lazily invalidate old exceptions:

```text
base_version++
old exception_version rows become invisible
cleanup later
```

That is a promotion optimization, not part of the correctness model.

`move_epoch` is the wrong abstraction here because the index does not care why a participant's local membership changed. The index operation is state-based:

```text
set_membership(participant, cohort, value, desired_local_member?)
```

If versioned lazy clearing is needed later, use names like:

```text
base_version
exception_version
```

not `move_epoch`.

### Failure and fallback behavior

Fallback remains the safety mechanism for participants that are not yet represented exactly in the shared index.

A participant should be in fallback when:

- It has registered but not seeded/aligned.
- Its cohort base cannot be safely adopted.
- The implementation detects uncertainty during recovery.
- The participant is being restored or resumed and exact index state is not yet known.

Fallback participants are conservatively routed as affected candidates. They should not be counted in `participant_count` for promotion until they become indexed participants.

### Memory model

Definitions:

- `P`: number of subquery participants
- `R`: number of routing edges
- `C`: number of subquery cohorts
- `V`: number of values in the shared dependency view
- `E`: number of outstanding sparse exceptions

Current approximate memory shape:

```text
O(P * V)
```

Proposed approximate memory shape:

```text
O(V + P + R + C + E)
```

In steady state, where consumers share the same view:

```text
E ~= 0
```

During a move, exception memory is proportional to the number of moved values and the number of participants whose local view differs from the base. Because the initial implementation does not promote across active participants, exceptions for values that have moved for every participant can remain until those values move back, the cohort drops to one participant, or a future compactor rewrites the base. This keeps the correctness model simple but makes telemetry on exception growth important.

The asymptotic change is the main point, but the constant factor matters because ETS rows are not free. The Erlang documentation notes that ETS table memory is measured in words, that a word is 4 or 8 bytes depending on the runtime, and that an ETS table starts with a fixed base cost plus per-element overhead. The local measurements below were taken on:

```text
OTP 28
Elixir 1.19.5
aarch64-apple-darwin24.5.0
internal word size = 8 bytes
```

Benchmark script:

```text
packages/sync-service/scripts/subquery_index_memory.exs
```

The benchmark uses small integer dependency values, so these figures are conservative. UUID/text-heavy workloads should benefit more because the current layout duplicates those larger values once per shape, while the proposed layout stores them once per cohort plus sparse exceptions.

The compact proposed figures include the lifecycle reverse indexes needed for bounded whole-subquery/cohort teardown:

```text
participant_meta
cohort_locks
cohort_meta
cohort_by_key
cohorts_by_node
node_meta
positive_edges
negated_edges
edges_by_participant
participants_by_cohort
participants_by_shape
cohorts_by_subquery
shape_ref_participant
shape_dep_participant
participant_count
cohort_value
exception_by_value
exception_by_participant
shape_fallback
node_fallback
node_shape
shape_node
shape_dep_node
```

The practical read is simple:

- When many participants share a view and divergence is rare, the new layout is dramatically smaller.
- During moves and sustained dependency churn, memory rises with `E`, but only for the values and participants that differ from the cohort base.
- Under heavy divergence, the new layout remains smaller, but the gap narrows as `E` approaches `P * V`.

#### Local measurements: current vs compact proposed layout

| Scenario | Current | Compact proposed | Savings |
|----------|---------|------------------|---------|
| 1 participant, 1k values, steady state | 349.3 KiB | 159.6 KiB | 54.3% |
| 10 participants, 1k values, steady state | 3.37 MiB | 171.1 KiB | 95.0% |
| 100 participants, 1k values, steady state | 33.65 MiB | 285.7 KiB | 99.2% |
| 100 participants, 10k values, steady state | 335.8 MiB | 1.1 MiB | 99.7% |
| 100 participants, 1k values, 100 moved x 1 lagging | 33.65 MiB | 299.7 KiB | 99.1% |
| 100 participants, 1k values, 100 moved x 10 lagging | 33.65 MiB | 462.4 KiB | 98.7% |
| 100 participants, 1k values, 100 moved x 99 lagging | 33.65 MiB | 1.8 MiB | 94.7% |
| 100 participants, 1k values, 1k moved x 99 lagging | 33.65 MiB | 15.41 MiB | 54.2% |

Interpretation:

- In the common steady-state case, the memory win is dramatic because the current layout stores the full dependency view once per participant, while the proposed layout stores it once per cohort.
- The proposed layout grows with `E` during divergence, as expected, but it remained materially smaller than the current layout even in the intentionally harsh `1k moved x 99 lagging` scenario.
- The current layout is flat across the move scenarios because it already pays the full per-participant exact-membership cost all the time.

#### Local measurements: compact layout vs earlier tagged RFC layout

| Scenario | Tagged RFC layout | Compact proposed | Savings |
|----------|-------------------|------------------|---------|
| 10 participants, 1k values, steady state | 200.6 KiB | 171.1 KiB | 14.7% |
| 100 participants, 1k values, steady state | 286.9 KiB | 285.7 KiB | 0.4% |
| 100 participants, 1k values, 100 moved x 10 lagging | 584.2 KiB | 462.4 KiB | 20.8% |

The lifecycle indexes make the steady-state tagged-vs-compact comparison close for some small synthetic cases, but the compact layout is still better under divergence and gives the implementation direct lifecycle lookup tables instead of tag-heavy rows in one shared table. This is why the RFC specifies compact `cohort_id` and `participant_id` values plus dedicated ETS tables.

#### 100k-shape customer workload estimates

These estimates use the same benchmark script, but extrapolate from measured ETS row costs instead of allocating the full 100k-shape tables. They preserve each workload file's observed ratio of:

- subquery occurrences per shape;
- distinct literal subqueries per subquery occurrence.

For HumanLayer and AutoArc, the shape basis is distinct `WHERE` clauses because those files do not include distinct shape-handle counts. For Hazel, the file includes distinct shape handles, so the estimate uses shape handles as the basis.

| Customer | Observed basis | Observed subquery occurrences -> literal cohorts | Shared occurrences | Subquery participants @100k shapes | Cohorts @100k shapes | Rows/cohort | Current | Compact proposed | Savings |
|----------|----------------|--------------------------------------------------|--------------------|------------------------------------|----------------------|-------------|---------|------------------|---------|
| HumanLayer | 75 distinct `WHERE`s | 134 -> 13 | 90.3% | 178,667 | 17,333 | 1,000 | 58.68 GiB | 1.8 GiB | 96.9% |
| HumanLayer | 75 distinct `WHERE`s | 134 -> 13 | 90.3% | 178,667 | 17,333 | 10,000 | 585.66 GiB | 15.8 GiB | 97.3% |
| AutoArc | 611 distinct `WHERE`s | 291 -> 209 | 28.2% | 47,627 | 34,206 | 1,000 | 15.64 GiB | 3.16 GiB | 79.8% |
| AutoArc | 611 distinct `WHERE`s | 291 -> 209 | 28.2% | 47,627 | 34,206 | 10,000 | 156.12 GiB | 30.8 GiB | 80.3% |
| Hazel | 13 distinct shape handles | 4 -> 4 | 0.0% | 30,769 | 30,769 | 1,000 | 10.1 GiB | 2.82 GiB | 72.1% |
| Hazel | 13 distinct shape handles | 4 -> 4 | 0.0% | 30,769 | 30,769 | 10,000 | 100.86 GiB | 27.69 GiB | 72.5% |

Interpretation:

- HumanLayer has high literal subquery sharing in the captured workload, so the shared-base design gives the largest asymptotic win.
- AutoArc still benefits substantially, but many cohorts are tenant/user-specific, so the compact design stores more base views.
- Hazel has no literal sharing in the captured workload. The estimate still shows a constant-factor reduction because the current simulation stores both routing and exact membership value rows per participant, while the proposed layout stores one base value row per one-participant cohort. There is no many-participant amortization for Hazel.

### Complexity Check

- **Is this the simplest approach?** No. The simplest approach is adding `shape_handle -> values` or tombstoning stale rows. Those approaches reduce removal latency but do not address the structural memory duplication. This proposal is the simplest index-only approach that addresses both memory and removal latency while preserving per-consumer move correctness.
- **Is this the most elegant end-state?** Probably not. A shared logical-time view, as explored in `docs/rfcs/subquery-logical-time-index.md`, models divergence directly as "participants are reading different times" and can also reduce duplicated consumer/materializer views. It is the cleaner long-term model, but it is a larger change because it crosses the SubqueryIndex, consumer state, move buffering, and query-generation boundaries.
- **What could we cut?** We can defer cross-participant promotion, versioned lazy promotion, strict O(1) removal under pathological exception counts, per-cohort ETS tables, and any major refactor outside the SubqueryIndex/consumer indexing boundary.
- **What's the 90/10 solution?** Implement dependency-handle cohorts with shared base membership and sparse XOR exceptions. Separate membership participants from routing edges. Keep fallback for uncertain cases. Compact only one-participant cohorts on the hot path. Do not add tombstones, generations, or lazy invalidation until measurements justify them.

### Recommendation Check

The current recommendation is to treat this RFC as the best near-term production
fix for issue #4279, not as the final architecture for all subquery state.

Why this remains a good next step:

- It fixes the observed shape-removal failure mode without adding a full-value
  reverse index per shape.
- It keeps changes mostly inside `SubqueryIndex` and the consumer seed/update
  boundary.
- The corrected memory model still shows large wins for shared cohorts, even
  after including routing-edge and node-lookup tables.

Why this may not be the final design:

- Consumer/materializer processes can still hold their own dependency views,
  including before/after views during active move-in buffering.
- Exception memory can grow with `moved_values * divergent_participants` during
  large, slow moves, and can remain high under sustained dependency churn until
  a later compaction strategy is added.
- Readiness is less elegant than logical time because a new participant must
  either seed a sparse diff or prove that it can adopt the current base.

If the implementation budget allows a broader refactor, evaluate the
logical-time RFC before starting this work. If the immediate goal is to remove
the WAL-lag risk from shape cleanup while reducing index memory, implement this
RFC first and collect the telemetry needed to decide whether logical time is
worth the larger migration.

## Open Questions

| Question | Options | Resolution Path |
|----------|---------|-----------------|
| **What exactly defines a cohort?** | Existing `node_id`; `{node_id, subquery_ref, dep_index}`; dependency shape handle; canonicalized dependency-query identity | Use dependency shape handle when available. It is the current runtime identity for a shared dependency view. Fall back to `{shape_handle, dep_index}` only when tests or restored state do not have dependency handles. Keep `cohorts_by_node` for routing from filter nodes to shared cohorts. |
| **What exactly defines `subquery_key` for teardown?** | Dependency shape handle; canonical subquery occurrence; dependency handle plus occurrence | Use dependency shape handle when available because it maps directly to all cohorts for a dependency lifecycle event. It must not be a merely shape-local `$sublink` ref. |
| **How can a new participant safely adopt the base?** | Adopt directly; remain fallback until quiescent; seed sparse diff; separate cohort | Define the readiness contract during implementation and add tests for registration during active moves. |
| **Where should base membership be stored?** | Shared ETS table; per-cohort ETS table; cohort owner process | Choose based on cleanup behavior and ETS key locality. Avoid synchronous O(V) cleanup when the last participant leaves a cohort. |
| **Should promotion happen during removal?** | Only for values touched by removed exceptions; never on removal; background compactor | Correctness does not require promotion on removal. Start with one-participant promotion only. Add cross-participant compaction if telemetry shows exception growth is material. |
| **How do we measure false fallback amplification?** | Count fallback candidates; count fallback duration; compare old/new candidate volume | Add telemetry during implementation and validate it in test/staging. Fallback should be rare and short-lived after participants are ready. |
| **Do we need versioned lazy promotion?** | Physical clearing; base/exception versions | Start with physical clearing for one-participant promotion only. Add versions only if a future cross-participant compactor needs them. |
| **Do we need tombstones for strict removal latency?** | Exact exception cleanup; inactive-participant tombstone | Do not add initially. Reconsider only if `E` can be very large in production and removal latency remains problematic. |

## Definition of Success

### Primary Hypothesis

> We believe that implementing **shared SubqueryIndex base views with sparse XOR exceptions** will make subquery-indexed shape removal scalable and reduce memory consumption, while preserving the v1.6 behavior that keeps boolean subquery shapes live across dependency moves.
>
> We'll know we're right if shape removal latency is independent of total indexed shape count and normal dependency view size, whole-subquery/cohort teardown does not scan unrelated shapes, SubqueryIndex memory scales approximately with shared values plus participants and routing edges rather than participants times values, and the existing subquery move correctness tests continue to pass.
>
> We'll know we're wrong if exception sets remain large or long-lived in normal traffic, fallback routing causes unacceptable write amplification, or registration/readiness around active moves requires so much complexity that the design is not safer than the current per-shape model.

### Functional Requirements

| Requirement | Acceptance Criteria |
|-------------|---------------------|
| Shape removal avoids full index scans | Removing a shape does not call broad `match_delete` or equivalent scans over value-keyed membership rows to find the shape. |
| Removal cost depends on sparse state | Removal is O(P + R + E), where P is subquery participants for the shape, R is routing edges for those participants, and E is outstanding sparse exceptions. |
| Whole-subquery teardown avoids global shape scans | Removing a subquery or cohort uses `cohorts_by_subquery` and `participants_by_cohort`, not enumeration of all shapes. |
| Whole-subquery teardown cost depends on affected state | Critical-path teardown is O(C + P_s + R_s + E_s), plus off-path base cleanup. |
| Common dependency view is shared | N participants with the same cohort view store one base membership set plus participant rows, not N full membership sets. |
| Positive routing remains exact | For positive subquery routing edges, candidate routing matches `base XOR exception`. |
| Negated routing remains exact | For negated subquery routing edges, candidate routing matches `NOT (base XOR exception)`. |
| DNF branch behavior is preserved | Candidates continue through the existing `WhereCondition` branch using `next_condition_id` and branch metadata. |
| Fallback is preserved | Participants that are not safely represented by base + exceptions are routed conservatively. |
| No tombstones in v1 | Removed participants are deleted from participant and exception indexes rather than marked dead. |
| No generations or move epochs in v1 | One-participant promotion physically clears exceptions for a value. No versioned lazy clearing is required for initial correctness. |
| Empty cohort cleanup is off the critical path | Removing the last participant from a cohort does not synchronously scan/delete a large base view on the replication-critical path. |
| Telemetry is sufficient for validation and operations | Metrics expose removal duration, base size, exception size, fallback size/duration, and promotion cost. |

### Learning Goals

1. How often do multiple shapes actually share the same subquery dependency view in production?
2. How large and long-lived do exception sets become during realistic move workloads?
3. Does fallback routing remain rare enough that conservative routing is not a throughput problem?
4. Are promotions frequent or large enough to justify versioned lazy clearing later?
5. Is dependency-handle cohorting enough, or do we need broader canonical dependency-plan interning to get the expected memory savings?

## Alternatives Considered

### Alternative 1: Add `shape_handle -> all values`

**Description:** Keep the current value-to-shape routing index and add a reverse index from each shape to all dependency values it currently contains.

**Why not:** This improves removal but increases memory use. It stores the full dependency view per shape twice, directly conflicting with the memory-reduction goal.

### Alternative 2: Tombstone removed shapes and clean later

**Description:** Mark removed shapes inactive, leave old index rows behind, make routing ignore inactive shapes, and clean stale rows later.

**Why not:** This is a plausible emergency mitigation for replication stalls, but it does not solve the structural memory problem. It also introduces stale-row cleanup debt and liveness checks into routing. The proposed design should not need shape tombstones because participant-owned rows are sparse exceptions.

### Alternative 3: One global widened filter

**Description:** Maintain one conservative global view per subquery node. Widen immediately when a move starts and narrow only when all consumers have processed the move.

**Why not:** This is simpler, but a stalled or slow consumer can keep the shared filter broad and over-route changes to every participant. It also depends more heavily on downstream exact filtering. The XOR exception design preserves exact per-participant membership while still representing the common case once.

### Alternative 4: Intern full dependency views

**Description:** Canonicalize complete dependency views, assign a `view_id`, and let shapes point to a shared view.

**Why not:** This directly addresses identical views, but one-value moves create new views or require persistent/delta view representation. Sparse XOR exceptions are a more incremental way to get the same benefit for temporary divergence.

### Alternative 5: Versioned lazy exception clearing

**Description:** On promotion, flip the base and increment a version so old exceptions become invisible without being physically deleted.

**Why not:** This can make promotion O(1), but it adds versioning complexity and cleanup debt. It is not needed for correctness. Defer until promotion cost is measured.

### Alternative 6: Shared logical-time views

**Description:** Replace per-participant exceptions with one versioned cohort view
and pin each participant to the logical time that matches its local state.

**Why not first:** This is the cleaner long-term design and can also reduce
consumer/materializer view duplication, but it crosses more subsystem
boundaries. It should be evaluated before implementation if the team is ready
for a broader refactor. For the narrower shape-removal and SubqueryIndex memory
problem, the XOR design is the lower-risk first step.

## Implementation Plan

This change ships as a single cutover release, not a staged rollout behind a feature flag. The development work can still happen in sequence:

### 1. Instrument and model

- Add telemetry around current SubqueryIndex shape removal latency and ETS row counts by row kind.
- Add telemetry around current subquery/dependency teardown paths to catch any scans over all shapes.
- Add debug/instrumentation to estimate duplicate dependency views or cohort-sharing potential.
- Build a small pure model of base + XOR exceptions with property tests:
  - random add/remove membership operations;
  - positive and negated routing truth tables;
  - participant registration/removal;
  - promotion;
  - fallback exclusion from promotion counts.

### 2. Implement the new index

- Add cohort, participant, and routing-edge registration structures.
- Add shape, cohort, and subquery lifecycle reverse indexes.
- Add base membership and sparse exception indexes.
- Implement `remove_participant`, `remove_cohort`, and `remove_subquery` helpers that share cleanup logic.
- Implement `set_membership/4`, `add_value`, and `remove_value` wrappers.
- Implement affected-shape routing for positive and negated routing edges.
- Keep existing fallback behavior for unready participants.
- Compare candidate routing and shape logs against the old implementation in tests where practical.

### 3. Integrate move handling and cut over

- Replace full per-shape membership seeding/updating with base adoption plus sparse exception updates.
- Define and implement the participant readiness contract.
- Land telemetry dashboards for:
  - removal duration;
  - whole-subquery/cohort teardown duration;
  - `base_member` count;
  - exception count and oldest exception age;
  - fallback participant count and duration;
  - promotion duration;
  - WAL lag correlation.
- Remove the old full per-shape membership representation as part of the same release.
- Add tests for:
  - move-in with one lagging consumer;
  - move-out with one lagging consumer;
  - negated subquery move-in/move-out;
  - OR/AND/NOT DNF branch combinations;
  - shape removal during active divergence;
  - cohort/subquery removal during active divergence;
  - shape registration during active divergence;
  - fallback-to-ready transitions.

## Test Plan

### Unit tests

- `local_member = base XOR exception` truth table.
- `set_membership` idempotency.
- One-participant promotion flips base and clears exceptions.
- Multi-participant updates preserve exact membership without promoting the shared base.
- Positive routing when base is absent/present.
- Negated routing when base is absent/present.
- Participant removal deletes only participant metadata and sparse exceptions.
- Removing a participant with no exceptions does not require scanning exception values.
- Removing a cohort enumerates `participants_by_cohort`, not all shapes.
- Removing a subquery enumerates `cohorts_by_subquery`, not all shapes.
- Empty cohort cleanup is not performed synchronously on the shape removal path.

### Property tests

Model the index as a map of exact participant membership and compare it to the base + exception implementation after random operations:

- register participant
- mark ready
- set membership true
- set membership false
- remove participant
- remove cohort
- remove subquery
- promote when eligible
- route positive
- route negated

The property should assert that for all ready participants and values:

```text
exact_model_member?(participant, value) ==
  base_member?(cohort, value) XOR exception?(cohort, value, participant)
```

### Integration tests

- Existing v1.6 boolean subquery move tests continue to pass.
- Move-in splicing still inserts rows at the correct point.
- Active conditions remain correct when one DNF position changes and another remains true.
- Shape removal during replication does not block on a scan proportional to total shapes or full dependency view size.
- Subquery/cohort removal during replication does not scan unrelated shapes.
- Fallback participants receive conservative routing until ready.

### Benchmark tests

Benchmarks should compare current and proposed index behavior for:

- `S` shapes sharing `V` dependency values, no exceptions
- `S` shapes sharing `V` dependency values, `M` moved values, `K` lagging participants
- shape removal with `E = 0`
- shape removal with `E > 0`
- subquery/cohort removal with sparse affected participants
- subquery/cohort removal with all participants affected
- promotion with `K` exceptions
- routing positive with base present/absent
- routing negated with base present/absent

Expected shape:

```text
current memory:             O(S * V)
proposed memory:            O(V + P + R + C + E)
current shape removal:      O(index scan / value rows)
proposed shape removal:     O(P + R + E)
proposed subquery removal:  O(C + P_s + R_s + E_s) plus off-path base cleanup
```

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Cohort key accidentally merges participants with different steady-state views | Use dependency shape handle as the default cohort key and add tests that prove views are shareable before interning more aggressively. |
| Participant joins base while its local view is not equal to base | Keep participant in fallback until readiness is proven. Make `mark_ready` assert or validate alignment. |
| Exceptions become large and long-lived | Add telemetry for exception count and age. Consider cohort rebuild, global compaction, or versioned lazy promotion if needed. |
| Promotion clearing becomes expensive or unsafe | Keep only one-participant promotion on the hot path; add base/exception versions only if measurements and synchronization design justify cross-participant compaction. |
| Empty cohort cleanup blocks replication | Store base members in cohort-owned storage or detach empty cohorts immediately and reclaim storage off the critical path. |
| Whole-subquery teardown scans all shapes | Keep `cohorts_by_subquery` and `participants_by_cohort` as required lifecycle indexes and test teardown with many unrelated shapes. |
| Routing set differences are expensive for negated conditions | Benchmark negated routing separately. Use polarity-specific participant indexes and efficient set operations. |
| Fallback hides correctness bugs | Track fallback duration and count. Tests should assert participants eventually leave fallback in normal paths. |

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.6 | 2026-05-14 | robacourt | Made promotion conservative after oracle testing exposed the risk of cross-participant base flips during independently processed dependency moves. The initial implementation now promotes only one-participant cohorts and treats multi-participant promotion as a future compaction optimization. |
| 0.5 | 2026-05-13 | robacourt | Re-evaluated the design against the current implementation, switched the recommended cohort key to dependency shape handle, split membership participants from routing edges, added the required node-to-cohort routing indexes, compared the XOR design with logical-time views, and regenerated memory figures. |
| 0.4 | 2026-05-13 | robacourt | Added explicit whole-subquery/cohort teardown requirements, reverse indexes, complexity bounds, regenerated memory figures, 100k-shape customer workload estimates, and tests to prevent O(total shapes) lifecycle scans. |
| 0.3 | 2026-05-06 | robacourt | Readability pass: tightened the opening sections, added a current-vs-proposed summary table, and converted pseudo-list code blocks into normal prose/lists. |
| 0.2 | 2026-05-06 | robacourt | Added measured ETS memory tables, switched the proposed layout to compact interned ids plus dedicated tables, and clarified the single-release cutover plan. |
| 0.1 | 2026-05-06 | robacourt | Initial draft based on issue #4279 and design discussion. |

---

## RFC Quality Checklist

Before submitting for review, verify:

**Alignment**

- [x] RFC addresses issue #4279 rather than a broader unrelated redesign
- [x] RFC avoids adding the memory-heavy `shape_handle -> all values` reverse index
- [x] RFC preserves the v1.6 subquery move correctness goal
- [ ] API naming matches ElectricSQL conventions after implementation details are finalized

**Calibration for Level 1-2 PMF**

- [x] This is the simplest approach that addresses both removal latency and memory duplication
- [x] Non-goals explicitly defer broader dependency-plan interning, lazy versions, and strict pathological O(1) removal
- [x] Complexity Check section is filled out honestly
- [x] An engineer could start by implementing the pure model and telemetry

**Completeness**

- [x] Happy path is clear
- [x] Critical failure modes are addressed
- [x] Open questions are acknowledged
- [x] Test plan covers positive, negated, DNF, move, fallback, removal, and benchmark behavior
