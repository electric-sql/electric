---
title: Shared SubqueryIndex Base View with Sparse XOR Exceptions
version: "0.1"
status: draft
owner: robacourt
contributors: []
created: 2026-05-06
last_updated: 2026-05-06
prd: N/A - based on https://github.com/electric-sql/electric/issues/4279
prd_version: N/A
---

# Shared SubqueryIndex Base View with Sparse XOR Exceptions

## Summary

Electric v1.6 introduced per-shape subquery indexing so each shape consumer could maintain the exact dependency view it needed while subquery rows moved across boolean `WHERE` clauses. That preserved correctness but made the index memory inefficient: in the common case many shapes have the same dependency view, yet the index stores that view once per shape. Shape removal now needs to clean up per-shape index entries and has been observed to block replication processing and cause WAL lag. This RFC proposes replacing full per-shape subquery membership with one shared base view per subquery index cohort plus sparse per-participant XOR exceptions for the short windows where consumers are out of sync. The design targets removal cost proportional to the shape's subquery participants and outstanding exceptions, not to total shapes or the shape's full dependency view.

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

The narrow fix would be to add a reverse index:

```text
shape_handle -> all indexed values for that shape
```

That would improve removal, but it would increase memory use for a structure that is already memory inefficient.

The wider design problem is that the current implementation optimizes for the exceptional case -- each shape consumer can have a distinct dependency view -- by paying the cost all the time. In practice, most consumers using the same subquery index cohort should have the same dependency view most of the time. They usually diverge only during subquery moves.

**Link to PRD hypothesis:** There is no PRD for this RFC. The working hypothesis comes from issue #4279:

> Redesigning the SubqueryIndex so it does not store full per-shape dependency views will make shape add/remove scalable and reduce memory consumption, while preserving v1.6 subquery move correctness.

## Goals & Non-Goals

### Goals

- Make shape removal independent of the total number of shapes in the SubqueryIndex.
- Make shape removal independent of the number of values in the shape's normal, non-divergent dependency view.
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
- Do not guarantee strict mathematical O(1) removal if a shape has a very large number of outstanding exceptions. The target is O(P + E), where `P` is the number of subquery participants for the shape and `E` is the number of outstanding sparse exceptions owned by those participants.
- Do not introduce lazy-cleanup mechanisms unless measurements show they are needed.

## Proposal

### Core idea

Represent the common dependency view once, and represent only the temporary differences per participant.

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

If the base says a value is absent and a participant sees a move-in, add an exception for that participant. If every indexed participant eventually has the exception, flip the base to present and clear the exceptions.

If the base says a value is present and a participant sees a move-out, add an exception for that participant. If every indexed participant eventually has the exception, flip the base to absent and clear the exceptions.

The index does not need to know whether a change came from move-in, move-out, broadening, narrowing, repair, or reseeding. It only needs a state-based operation:

```text
set_membership(participant, cohort, value, desired_local_member?)
```

### Terminology

#### Cohort

A cohort is the unit that shares a base dependency view.

For the first implementation, a cohort should be conservative: it should include only participants whose dependency membership can safely be represented by the same base. A practical first version can define a cohort around the existing subquery filter node plus the dependency identity needed to avoid merging unlike views.

Example shape:

```text
cohort_id = {node_id, subquery_ref, dep_index}
```

The exact tuple should be decided during implementation. The important rule is:

```text
if two participants can have different steady-state dependency views for reasons other than temporary move ordering, they must not share a cohort
```

Later versions can intern cohorts more aggressively across equivalent nodes or equivalent subquery dependency plans, but that is not required for this RFC.

#### Participant

A participant is a shape's position in a subquery filter node, not necessarily just the shape handle.

The current index stores rows involving:

```text
shape_handle
node_id
dep_index
polarity
next_condition_id
branch_key
```

The new design should keep that distinction. A participant can be represented as a small stable identifier that maps to the routing metadata needed to continue evaluation through `WhereCondition`.

Conceptually:

```text
participant = {
  shape_handle,
  cohort_id,
  polarity,
  next_condition_id,
  branch_key
}
```

### Data model

The following is a conceptual ETS layout. The implementation can split these across ETS tables if that gives better key locality or simpler cleanup.

```text
# Participants registered on a cohort, split by polarity for routing.
{{:participants, cohort_id, :positive}, participant} -> true
{{:participants, cohort_id, :negated}, participant} -> true

# Reverse lookup for removal.
{{:participants_by_shape, shape_handle}, participant} -> true

# Count of indexed participants in a cohort.
# This excludes fallback participants that are not yet safely represented by base + exceptions.
{:participant_count, cohort_id} -> non_neg_integer

# Shared base dependency membership.
{{:base_member, cohort_id, value}, true}

# Sparse exceptions by value, used during routing and promotion.
{{:exception_by_value, cohort_id, value}, participant} -> true

# Sparse exceptions by participant, used during shape removal.
{{:exception_by_participant, participant}, {cohort_id, value}} -> true

# Count of exceptions for a value, used to decide when to promote.
{:exception_count, cohort_id, value} -> non_neg_integer

# Existing conservative fallback routing remains.
{{:node_fallback, node_id}, {shape_handle, next_condition_id}} -> true
```

The new reverse index is intentionally sparse:

```text
participant -> outstanding exception values only
```

It is not the rejected memory-heavy reverse index:

```text
shape_handle -> all values in the full dependency view
```

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

If all indexed participants in a cohort have an exception for the same value, the base is now the minority representation. Flip it and clear the exceptions:

```text
maybe_promote(cohort, value):
  if exception_count(cohort, value) == participant_count(cohort)
     and participant_count(cohort) > 0:
    if base_member?(cohort, value):
      delete base_member(cohort, value)
    else:
      insert base_member(cohort, value)

    for participant in exception_by_value(cohort, value):
      delete exception_by_participant(participant, cohort, value)
      delete exception_by_value(cohort, value, participant)

    delete exception_count(cohort, value)
```

The initial implementation should physically clear exceptions during promotion. This avoids generations or versions in the core design.

Promotion is O(number of exceptions for that value). In the normal case this is bounded by the number of participants in the cohort and occurs only for values that actually moved.

A later optimization may add versioned lazy clearing if promotion-time clearing becomes expensive. That would be a performance optimization, not a correctness requirement.

### Routing

Routing uses the same `local_member = base XOR exception` idea, but it computes candidate participants in bulk.

For positive subquery participants:

```text
if base_member?(cohort, value):
  matching_positive = positive_participants(cohort) - exceptions(cohort, value, :positive)
else:
  matching_positive = exceptions(cohort, value, :positive)
```

For negated subquery participants:

```text
if base_member?(cohort, value):
  matching_negated = exceptions(cohort, value, :negated)
else:
  matching_negated = negated_participants(cohort) - exceptions(cohort, value, :negated)
```

Then fallback participants are unioned in, as today:

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

A newly registered participant should not be counted as an indexed participant until it is safe to represent it as:

```text
base + sparse exceptions
```

Before that point, it remains in fallback routing, as today.

The common-case registration path should be:

```text
1. Register participant metadata.
2. Attach participant to the existing cohort base with no exceptions.
3. Increment participant_count.
4. Remove participant from fallback once ready.
```

That path is O(number of participants in the shape), not O(number of values in the dependency view), provided the participant can safely adopt the cohort base.

If a participant starts while a move is in progress, or if it cannot prove that its local dependency view equals the cohort base, it must stay in fallback until one of these is true:

```text
- it can adopt the base safely;
- it can seed the exact sparse diff from the base;
- the cohort is rebuilt or compacted; or
- the implementation chooses a separate cohort for it.
```

This is an important correctness boundary. Joining a participant with no exceptions asserts that its local view equals the base. The implementation must not make that assertion unless it is true.

### Shape removal

Shape removal deletes participant metadata and any sparse exceptions owned by those participants. It does not delete the shape's full dependency view because that full view is not stored per shape.

```text
remove_shape(shape_handle):
  for participant in participants_by_shape(shape_handle):
    remove participant from participants(cohort, polarity)
    decrement participant_count(cohort)

    for {cohort, value} in exception_by_participant(participant):
      delete exception_by_value(cohort, value, participant)
      delete exception_by_participant(participant, cohort, value)
      decrement exception_count(cohort, value)
      maybe_promote(cohort, value)  # optional for touched values only

    delete participant metadata

  remove fallback rows for shape_handle
```

Complexity:

```text
O(P + E)
```

where:

```text
P = number of indexed subquery participants owned by the shape
E = number of outstanding exception rows owned by those participants
```

In the common case, `E = 0`, so removal is proportional only to the number of subquery positions in the shape.

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

```text
- it has registered but not seeded/aligned;
- its cohort base cannot be safely adopted;
- the implementation detects uncertainty during recovery;
- the participant is being restored or resumed and exact index state is not yet known.
```

Fallback participants are conservatively routed as affected candidates. They should not be counted in `participant_count` for promotion until they become indexed participants.

### Memory model

Let:

```text
S = number of shapes
P = number of subquery participants
V = number of values in the shared dependency view
E = number of outstanding sparse exceptions
```

Current approximate memory shape:

```text
O(P * V)
```

Proposed approximate memory shape:

```text
O(V + P + E)
```

In steady state, where consumers share the same view:

```text
E ~= 0
```

During a move, exception memory is proportional to the number of moved values and the number of participants that are temporarily out of sync with the base.

### Complexity Check

- **Is this the simplest approach?** No. The simplest approach is adding `shape_handle -> values` or tombstoning stale rows. Those approaches reduce removal latency but do not address the structural memory duplication. This proposal is the simplest approach that addresses both memory and removal latency while preserving per-consumer move correctness.
- **What could we cut?** We can defer cross-node cohort interning, versioned lazy promotion, strict O(1) removal under pathological exception counts, and any major refactor outside the SubqueryIndex/consumer indexing boundary.
- **What's the 90/10 solution?** Implement node-local cohorts with shared base membership and sparse XOR exceptions. Keep fallback for uncertain cases. Physically clear exceptions on promotion. Do not add tombstones, generations, or lazy invalidation until measurements justify them.

## Open Questions

| Question | Options | Resolution Path |
|----------|---------|-----------------|
| **What exactly defines a cohort?** | Existing `node_id`; `{node_id, subquery_ref, dep_index}`; canonicalized dependency-query identity | Start conservative with a cohort key that cannot merge unlike views. Instrument duplicate-view/cohort-sharing opportunities before broader interning. |
| **How can a new participant safely adopt the base?** | Adopt directly; remain fallback until quiescent; seed sparse diff; separate cohort | Define the readiness contract during implementation and add tests for registration during active moves. |
| **Where should base membership be stored?** | Shared ETS table; per-cohort ETS table; cohort owner process | Choose based on cleanup behavior and ETS key locality. Avoid synchronous O(V) cleanup when the last participant leaves a cohort. |
| **Should promotion happen during removal?** | Only for values touched by removed exceptions; never on removal; background compactor | Correctness does not require promotion on removal. Start with promotion only when values are touched by updates/removal of exceptions. Add compaction if needed. |
| **How do we measure false fallback amplification?** | Count fallback candidates; count fallback duration; compare old/new candidate volume | Add telemetry before rollout. Fallback should be rare and short-lived after participants are ready. |
| **Do we need versioned lazy promotion?** | Physical clearing; base/exception versions | Start with physical clearing. Add versions only if promotion clearing becomes a measured bottleneck. |
| **Do we need tombstones for strict removal latency?** | Exact exception cleanup; inactive-participant tombstone | Do not add initially. Reconsider only if `E` can be very large in production and removal latency remains problematic. |

## Definition of Success

### Primary Hypothesis

> We believe that implementing **shared SubqueryIndex base views with sparse XOR exceptions** will make subquery-indexed shape removal scalable and reduce memory consumption, while preserving the v1.6 behavior that keeps boolean subquery shapes live across dependency moves.
>
> We'll know we're right if shape removal latency is independent of total indexed shape count and normal dependency view size, SubqueryIndex memory scales approximately with shared values plus participants rather than participants times values, and the existing subquery move correctness tests continue to pass.
>
> We'll know we're wrong if exception sets remain large or long-lived in normal traffic, fallback routing causes unacceptable write amplification, or registration/readiness around active moves requires so much complexity that the design is not safer than the current per-shape model.

### Functional Requirements

| Requirement | Acceptance Criteria |
|-------------|---------------------|
| Shape removal avoids full index scans | Removing a shape does not call broad `match_delete` or equivalent scans over value-keyed membership rows to find the shape. |
| Removal cost depends on sparse state | Removal is O(P + E), where P is subquery participants for the shape and E is outstanding sparse exceptions for those participants. |
| Common dependency view is shared | N participants with the same cohort view store one base membership set plus participant rows, not N full membership sets. |
| Positive routing remains exact | For positive subquery participants, candidate routing matches `base XOR exception`. |
| Negated routing remains exact | For negated subquery participants, candidate routing matches `NOT (base XOR exception)`. |
| DNF branch behavior is preserved | Candidates continue through the existing `WhereCondition` branch using `next_condition_id` and branch metadata. |
| Fallback is preserved | Participants that are not safely represented by base + exceptions are routed conservatively. |
| No tombstones in v1 | Removed participants are deleted from participant and exception indexes rather than marked dead. |
| No generations or move epochs in v1 | Promotion physically clears exceptions for a value. No versioned lazy clearing is required for initial correctness. |
| Empty cohort cleanup is off the critical path | Removing the last participant from a cohort does not synchronously scan/delete a large base view on the replication-critical path. |
| Telemetry is sufficient for rollout | Metrics expose removal duration, base size, exception size, fallback size/duration, and promotion cost. |

### Learning Goals

1. How often do multiple shapes actually share the same subquery dependency view in production?
2. How large and long-lived do exception sets become during realistic move workloads?
3. Does fallback routing remain rare enough that conservative routing is not a throughput problem?
4. Are promotions frequent or large enough to justify versioned lazy clearing later?
5. Is node-local cohorting enough, or do we need cross-node/cross-shape cohort interning to get the expected memory savings?

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

## Implementation Plan

### Phase 1: Instrument and model

- Add telemetry around current SubqueryIndex shape removal latency and ETS row counts by row kind.
- Add debug/instrumentation to estimate duplicate dependency views or cohort-sharing potential.
- Build a small pure model of base + XOR exceptions with property tests:
  - random add/remove membership operations;
  - positive and negated routing truth tables;
  - participant registration/removal;
  - promotion;
  - fallback exclusion from promotion counts.

### Phase 2: Introduce the new index behind a feature flag

- Add cohort and participant registration structures.
- Add base membership and sparse exception indexes.
- Implement `set_membership/4`, `add_value`, and `remove_value` wrappers.
- Implement affected-shape routing for positive and negated participants.
- Keep existing fallback behavior for unready participants.
- Run old and new index implementations side by side in tests where practical.

### Phase 3: Integrate with shape consumer move handling

- Replace full per-shape membership seeding/updating with base adoption plus sparse exception updates.
- Define and implement the participant readiness contract.
- Add tests for:
  - move-in with one lagging consumer;
  - move-out with one lagging consumer;
  - negated subquery move-in/move-out;
  - OR/AND/NOT DNF branch combinations;
  - shape removal during active divergence;
  - shape registration during active divergence;
  - fallback-to-ready transitions.

### Phase 4: Roll out and remove old representation

- Gate the new index behind configuration.
- Compare candidate routing and shape logs against the old implementation in test/staging.
- Roll out with telemetry dashboards for:
  - removal duration;
  - `base_member` count;
  - exception count and oldest exception age;
  - fallback participant count and duration;
  - promotion duration;
  - WAL lag correlation.
- Remove the old full per-shape membership representation once confidence is high.

## Test Plan

### Unit tests

- `local_member = base XOR exception` truth table.
- `set_membership` idempotency.
- Promotion flips base and clears exceptions.
- Positive routing when base is absent/present.
- Negated routing when base is absent/present.
- Participant removal deletes only participant metadata and sparse exceptions.
- Removing a participant with no exceptions does not require scanning exception values.
- Empty cohort cleanup is not performed synchronously on the shape removal path.

### Property tests

Model the index as a map of exact participant membership and compare it to the base + exception implementation after random operations:

```text
register participant
mark ready
set membership true
set membership false
remove participant
promote when eligible
route positive
route negated
```

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
- Fallback participants receive conservative routing until ready.

### Benchmark tests

Benchmarks should compare current and proposed index behavior for:

```text
S shapes sharing V dependency values, no exceptions
S shapes sharing V dependency values, M moved values, K lagging participants
shape removal with E = 0
shape removal with E > 0
promotion with K exceptions
routing positive with base present/absent
routing negated with base present/absent
```

Expected shape:

```text
current memory:   O(S * V)
proposed memory:  O(V + S + E)
current removal:  O(index scan / value rows)
proposed removal: O(P + E)
```

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Cohort key accidentally merges participants with different steady-state views | Start with conservative cohort keys and add tests that prove views are shareable before interning more aggressively. |
| Participant joins base while its local view is not equal to base | Keep participant in fallback until readiness is proven. Make `mark_ready` assert or validate alignment. |
| Exceptions become large and long-lived | Add telemetry for exception count and age. Consider cohort rebuild, global compaction, or versioned lazy promotion if needed. |
| Promotion clearing becomes expensive | Defer initially; add base/exception versions only if measurements show promotion cost is material. |
| Empty cohort cleanup blocks replication | Store base members in cohort-owned storage or detach empty cohorts immediately and reclaim storage off the critical path. |
| Routing set differences are expensive for negated conditions | Benchmark negated routing separately. Use polarity-specific participant indexes and efficient set operations. |
| Fallback hides correctness bugs | Track fallback duration and count. Tests should assert participants eventually leave fallback in normal paths. |

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
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
- [x] Non-goals explicitly defer cross-node interning, lazy versions, and strict pathological O(1) removal
- [x] Complexity Check section is filled out honestly
- [x] An engineer could start by implementing the pure model and telemetry

**Completeness**

- [x] Happy path is clear
- [x] Critical failure modes are addressed
- [x] Open questions are acknowledged
- [x] Test plan covers positive, negated, DNF, move, fallback, removal, and benchmark behavior
