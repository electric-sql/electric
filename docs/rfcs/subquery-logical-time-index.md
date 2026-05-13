---
title: Shared Subquery Views with Logical-Time Reads
version: "0.1"
status: draft
owner: robacourt
contributors: []
created: 2026-05-13
last_updated: 2026-05-13
prd: N/A - based on https://github.com/electric-sql/electric/issues/4279
prd_version: N/A
---

# Shared Subquery Views with Logical-Time Reads

## Summary

Electric v1.6 introduced per-shape subquery indexing so consumers can keep
boolean subquery shapes live while dependency rows move across `WHERE`
boundaries. That solved correctness, but it made memory scale with the number of
shape consumers. Each consumer can keep its own materialized dependency view in
the `SubqueryIndex`, and while move-ins are buffered it can also hold both a
before and after view.

This RFC proposes replacing per-consumer materialized subquery views with one
shared, versioned view per subquery cohort. Consumers do not copy the view.
Instead, they pin a logical time and read the shared view at that time:

```text
M(100) = [1, 2, 3, 4]
M(101) = [1, 2, 3, 4, 5]
```

The shape filter routes rows through every active logical time for the cohort,
then exact evaluation reads the participant's pinned time. History before the
earliest pinned time can be compacted.

The target outcome is:

- one materialized dependency view per cohort, not per shape consumer;
- exact reads at multiple in-flight logical times;
- shape removal that deletes participant metadata without scanning a full
  dependency view;
- memory that scales approximately with shared values plus value transitions
  plus participants, not participants times values.

## Background

Related implementation work:

- Commit: https://github.com/electric-sql/electric/commit/a04b25962cdb7ca86c4434585b6f74c758e1a31b
- PR: https://github.com/electric-sql/electric/pull/4051
- Earlier RFC: `docs/rfcs/subquery-index.md`
- Current index: `packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex`
- Prototype: `packages/sync-service/lib/electric/shapes/filter/indexes/logical_time_subquery_index.ex`

The v1.6 work lets shapes with boolean combinations around subqueries remain
live when dependency rows move. The key correctness problem is that consumers can
temporarily disagree about a subquery's membership while one consumer has
processed a move and another has not.

The current implementation handles that by letting each shape consumer seed and
update exact per-shape membership rows. That keeps each consumer correct, but it
duplicates the same view across many shapes. During move-in buffering, the
consumer also carries before and after views so it can convert buffered
transactions and build the move-in query.

The earlier XOR RFC reduces `SubqueryIndex` duplication by storing a shared base
plus sparse per-participant exceptions. This RFC takes a broader approach:
subquery views are versioned by logical time, and consumers read shared history
at the time that matches their local state.

## Problem

The memory problem is broader than value-keyed routing rows in `SubqueryIndex`.
There are at least two duplicated memory pools:

1. `SubqueryIndex` membership and routing rows, currently keyed by shape.
2. Consumer/materializer views, including before and after views during active
   move-in buffering.

Adding a reverse index such as `shape_handle -> all values` would make removal
faster, but it would increase memory.

The XOR sparse-exception design improves the index, but it still models
temporary divergence as participant exceptions. If many values move while many
participants are at a different state from the base, exception memory grows with
`moved_values * divergent_participants`. It also does not directly remove the
need for before and after materialized view copies in the consumer move path.

The underlying shape of the problem is versioned reads over a shared data set.
The system needs to answer:

```text
does value V belong to subquery cohort C at logical time T?
which participants need rows for V across all active logical times?
which values belong to C at T when building SQL params for a move query?
what history can be compacted now that no consumer can read it?
```

This is similar to the timestamped arrangements and compaction frontiers used by
differential dataflow systems, but the first Electric version can be much
smaller and narrower.

## Goals

- Store one shared materialized subquery view per cohort.
- Support exact membership reads at separate logical times.
- Let a consumer pin the before and after times it needs during a move.
- Route root-table changes for all active logical times without per-shape value
  copies.
- Make shape removal proportional to the number of participants owned by the
  shape, not to the size of the dependency view.
- Compact history before the earliest in-flight logical time.
- Preserve positive, negated, AND, OR, and NOT subquery correctness from v1.6.
- Measure memory and routing/member performance against current and XOR-like
  alternatives before integrating.

## Non-Goals

- Do not change the client wire protocol.
- Do not replace Electric's replication pipeline with a general differential
  dataflow runtime.
- Do not require a two-step rollout through the XOR design.
- Do not guarantee O(1) enumeration of `values_at(time)`. Move query generation
  already needs the values, so O(view size) enumeration is acceptable initially.
- Do not solve cross-node cohort interning in the first implementation.
- Do not retain history before the minimum pinned time.

## Proposal

### Core Idea

Represent each cohort's dependency membership as value histories over logical
time:

```text
history[cohort, value] = [
  {time, member?},
  ...
]
```

The current membership at a time is the latest history entry with
`entry.time <= time`. If no entry exists, the value is absent.

For example:

```text
history[users_enabled, 5] = [{101, true}]

member?(users_enabled, 100, 5) = false
member?(users_enabled, 101, 5) = true
```

Consumers and filter participants do not own copies of the values. They own a
logical-time pointer:

```text
participant = {
  shape_handle,
  cohort_id,
  polarity,
  next_condition_id,
  logical_time
}
```

### Cohorts

A cohort is the unit that shares one materialized view. The first implementation
should use conservative cohort keys so unlike steady-state views are not merged.

A practical first cohort key is:

```text
{subquery_ref, dependency_shape_handle, dependency_identity}
```

or, if integrating first at the filter-node boundary:

```text
{node_id, subquery_ref, dep_index}
```

The rule is:

```text
participants can share a cohort only if their steady-state dependency view is the same
```

Later implementations can intern equivalent dependency plans more aggressively.

### Logical Times

Each cohort has a monotonically increasing logical time. When a dependency
materializer observes membership boundary changes, it applies them as one
logical-time delta:

```text
advance(cohort, changes):
  next_time = latest_time(cohort) + 1
  for {value, desired_member?} in changes:
    append history entry at next_time if membership changed
  latest_time(cohort) = next_time
  return next_time
```

The dependency materializer should still track counts internally. A value only
emits a logical membership change when its count crosses the `0 <-> 1`
boundary:

```text
0 -> 1: member? = true
1 -> 0: member? = false
```

Count changes that keep membership true do not need to create history entries.

### Consumer State

A steady consumer pins the latest logical time for each dependency cohort.

When a move-in starts, the consumer pins:

```text
views_before_move_time
views_after_move_time
```

Buffered transactions before the splice boundary are evaluated against the
before time. Transactions after the boundary are evaluated against the after
time. Move-in query generation uses the same two logical times instead of two
copied `MapSet` views.

After the splice completes, the consumer releases the before time and advances
its participant to the after time.

### Routing

The filter index must route changes for all active logical times in a cohort.

Instead of storing every participant under every value, store participants by
active logical time:

```text
participants_by_time:
  {cohort_id, logical_time, polarity} -> participant_id
```

Routing a root-table value then becomes:

```text
route(cohort, value):
  for time in active_times(cohort):
    if member?(cohort, time, value):
      route positive participants at time
    else:
      route negated participants at time
```

This is the "widening" step: if two logical times are in flight, routing allows
rows through for both. Exact evaluation remains precise because each participant
continues with its own pinned time.

### Exact Evaluation

`WhereClause.includes_record?/3` currently receives a `subquery_member?`
callback. Under this design, the callback should read the participant's logical
time:

```text
subquery_member?(participant_id, subquery_ref, value):
  cohort = participant.cohort_for(subquery_ref)
  time = participant.logical_time
  member?(cohort, time, value)
```

This is the critical correctness distinction from a purely widened filter.
Widening prevents false negatives in routing, but exact evaluation must still be
time-specific.

### View Enumeration

Move-in query generation and active condition SQL need to enumerate the values
at a time:

```text
values_at(cohort, time)
```

The first implementation can compute this by scanning the cohort's value
histories and filtering with `member?(cohort, time, value)`. That is O(V), but
the query needs O(V) params anyway.

A later version can add a cached per-time value list if measurements show query
generation is bottlenecked by enumeration.

### Compaction

Each cohort tracks active logical times. The compaction frontier is:

```text
min(active_times(cohort))
```

History before that frontier can be compacted away while preserving the
membership state at the frontier:

```text
compact(cohort, min_time):
  for each value history:
    keep entries with time >= min_time
    keep one boundary entry at min_time if the value was present there
    delete the value history if it is absent for all retained times
```

No consumer may read before the frontier after compaction.

### Shape Removal

Removing a shape deletes participant metadata and releases its pinned logical
times:

```text
remove_shape(shape_handle):
  for participant in participants_by_shape(shape_handle):
    remove participant from participants_by_time
    decrement active_time_count(cohort, participant.logical_time)
    delete participant metadata

  maybe advance cohort compaction frontier
```

The shape's full dependency view is not deleted because the shape does not own a
copy of it.

### Empty Cohort Cleanup

When the last participant leaves a cohort, routing can detach the cohort
immediately. The value history can be reclaimed off the replication-critical
path.

Acceptable first approaches:

1. Keep cohort-owned ETS tables and delete the whole table asynchronously.
2. Keep shared ETS tables but enqueue bounded cleanup by cohort id.
3. Use a cohort owner process that can be shut down once detached.

The important requirement is that removing the last shape must not scan and
delete a large value history synchronously.

## Prototype

The prototype is intentionally isolated and not wired into production:

```text
packages/sync-service/lib/electric/shapes/filter/indexes/logical_time_subquery_index.ex
packages/sync-service/test/electric/shapes/filter/logical_time_subquery_index_test.exs
packages/sync-service/scripts/subquery_logical_time_index_bench.exs
```

The current prototype uses these ETS tables:

```text
cohorts:
  {cohort_id, latest_time}

value_history:
  {{cohort_id, value}, [{time, member?}, ...]}

participants:
  {participant_id, cohort_id, shape_handle, polarity, logical_time, routing}

participants_by_shape:
  {shape_handle, participant_id}

participants_by_time:
  {{cohort_id, logical_time, polarity}, participant_id}

active_time_counts:
  {{cohort_id, logical_time}, count}

cohort_times:
  {cohort_id, logical_time}
```

The value history is stored as one ETS row per value with a short in-row list of
transitions. This is optimized for the expected case: most values have one
entry, and only recently moved values have more. If values move frequently, a
row-per-transition ordered-set layout should be benchmarked as an alternative.

The optimized prototype intentionally does not keep a duplicate
`cohort -> values` ETS table. `values_at/3` enumerates values from
`value_history`, reducing steady-state memory at the cost of an O(V) scan on a
path that already needs O(V) query params.

## Prototype Measurements

Command:

```sh
cd packages/sync-service
mix run --no-start scripts/subquery_logical_time_index_bench.exs
```

Environment:

```text
OTP 27
Elixir 1.18.3
word size = 8 bytes
```

The benchmark compares:

- current per-shape membership simulation;
- a compact XOR sparse-exception simulation;
- the logical-time prototype.

The moved scenarios model two active logical times. `divergent` means the number
of participants still at the old logical time for moved values. The XOR column
uses a best-case sparse representation with one exception per divergent
participant per moved value.

### ETS Memory

| Scenario | Current per-shape | XOR sparse | Logical-time | Logical vs current |
|----------|-------------------|------------|--------------|--------------------|
| 1 participant, 1k values, steady | 301.7 KiB | 121.3 KiB | 152.7 KiB | 49.4% |
| 10 participants, 1k values, steady | 2.91 MiB | 124.0 KiB | 154.7 KiB | 94.8% |
| 100 participants, 1k values, steady | 29.0 MiB | 150.7 KiB | 175.1 KiB | 99.4% |
| 100 participants, 10k values, steady | 289.96 MiB | 988.2 KiB | 1.26 MiB | 99.6% |
| 100 participants, 1k values, 100 moved x 1 divergent | 26.13 MiB | 164.8 KiB | 179.1 KiB | 99.3% |
| 100 participants, 1k values, 100 moved x 10 divergent | 26.39 MiB | 327.5 KiB | 179.1 KiB | 99.3% |
| 100 participants, 1k values, 100 moved x 99 divergent | 28.97 MiB | 1.67 MiB | 179.1 KiB | 99.4% |
| 100 participants, 1k values, 1k moved x 99 divergent | 28.71 MiB | 15.28 MiB | 214.3 KiB | 99.3% |

Interpretation:

- The logical-time prototype is dramatically smaller than the current per-shape
  layout once more than one participant shares a cohort.
- The XOR sparse layout is slightly smaller in steady state in this prototype.
- The logical-time layout stays almost flat as divergent participant count
  grows because divergence is represented by participant time pointers, not
  per-value per-participant exceptions.
- In the harsh `1k moved x 99 divergent` case, logical-time used 214.3 KiB
  versus 15.28 MiB for the XOR sparse simulation.

### Microbenchmarks

Scenario:

```text
100 participants, 1k values, 100 moved values, 10 divergent participants
20,000 iterations
```

| Operation | Current per-shape | XOR sparse | Logical-time |
|-----------|-------------------|------------|--------------|
| route moved value | 1.078 us | 0.45 us | 0.792 us |
| exact member? | 0.06 us | 0.214 us | 0.097 us |

Interpretation:

- Logical-time routing is within the same microsecond range for this two-time
  scenario.
- Exact membership is slower than current direct ETS key lookup, but still
  sub-microsecond in the prototype.
- XOR routing is fastest for this case because the benchmark uses a sparse
  exception set and a direct value-keyed exception lookup.

## Complexity

Definitions:

- `V`: values ever retained in the cohort history.
- `D`: values with retained transitions after the base time.
- `P`: participants in the cohort.
- `T`: active logical times.
- `H`: retained history entries for one value.

Approximate memory:

| Design | Memory |
|--------|--------|
| Current per-shape | `O(P * V)` |
| XOR sparse exceptions | `O(V + P + moved_values * divergent_participants)` |
| Logical-time views | `O(V + D + P + T)` |

Operation costs:

| Operation | Logical-time expected cost |
|-----------|----------------------------|
| `member?(cohort, time, value)` | `O(H)` with short in-row history |
| `route(cohort, value)` | `O(T * H + matching_participants)` |
| `values_at(cohort, time)` | `O(V * H)` |
| `advance(cohort, changes)` | `O(changed_values * H)` |
| `remove_shape(shape)` | `O(participants_owned_by_shape)` |
| `compact(cohort, frontier)` | `O(V * retained_history_per_value)` |

The key assumption is that `T` and `H` are small in normal operation. Telemetry
must validate that assumption.

## Integration Plan

### 1. Strengthen the Prototype

- Add a pure model/property test that compares exact per-participant membership
  with logical-time membership after random advances, participant time changes,
  removals, and compactions.
- Add a second prototype layout using row-per-transition ETS entries and compare
  it with the current in-row history list.
- Add scenarios with frequent repeated moves for the same value.
- Add scenarios with multiple cohorts and multiple active times.

### 2. Introduce Shared Cohort Materialization

- Move dependency materializer link values into shared cohort storage.
- Preserve value counts so only `0 <-> 1` transitions advance logical
  membership.
- Return both typed values and original string values needed by existing move
  effects.
- Add cohort lifecycle ownership and off-path empty cohort cleanup.

### 3. Update Consumer Move Handling

- Replace `views_before_move` and `views_after_move` `MapSet` copies with
  logical-time pins.
- Update `Querying.move_in_where_clause/5` and active condition SQL generation
  to use `values_at(cohort, time)`.
- Ensure buffered transaction conversion receives old and new logical-time
  callbacks.
- Release pins after splice completion and update participant logical times.

### 4. Replace SubqueryIndex Membership

- Register participants by cohort, polarity, branch metadata, and logical time.
- Route through all active logical times.
- Update exact `subquery_member?` callbacks to read the participant time.
- Remove per-shape full membership rows.
- Keep conservative fallback routing for participants that are not ready.

### 5. Add Telemetry

Metrics should expose:

- cohort count;
- values per cohort;
- history entries per cohort;
- active logical times per cohort;
- oldest pinned time age;
- compaction duration and reclaimed entries;
- route candidate counts by logical time;
- `values_at` duration and value count;
- shape removal duration.

## Test Plan

Unit tests:

- `member?(time, value)` across move-in and move-out transitions.
- positive and negated routing with two active logical times.
- participant time changes update routing.
- shape removal deletes participant metadata without touching value history.
- compaction preserves reads at and after the frontier.
- `values_at(time)` matches exact model views.

Property tests:

- Generate random value membership changes and participant time moves.
- Compare logical-time results against an exact per-participant model.
- Randomly compact at the minimum active time and verify reads at retained times.

Integration tests:

- Existing v1.6 boolean subquery move tests continue to pass.
- Move-in splicing evaluates pre-boundary and post-boundary transactions against
  different times.
- Negated subquery move-in and move-out remain exact.
- AND/OR/NOT DNF branch behavior is preserved.
- Shape registration during active moves stays in fallback until it can pin a
  safe time.
- Shape removal during active divergence does not scan a full view.

Benchmark tests:

- Steady-state memory for many participants sharing one cohort.
- Memory with many moved values and many divergent participants.
- Routing with one active time, two active times, and many active times.
- Exact membership for short and long value histories.
- `values_at` for large views.
- Compaction cost and reclaimed memory.

## Alternatives Considered

### Alternative 1: Shared Base View with Sparse XOR Exceptions

Description: Store one base membership set per cohort and per-participant XOR
exceptions for temporary divergence.

Why not first: This is a strong index-only design and remains a useful fallback,
but it does not directly solve before/after materializer view copies. Its
exception memory grows with `moved_values * divergent_participants`, which is
exactly the case where logical-time pointers stay compact.

Where it may still win: For steady-state routing with very few active moves, XOR
can use direct value-keyed routing and has slightly lower memory in the current
prototype benchmark.

### Alternative 2: Add `shape_handle -> all values`

Description: Keep the current per-shape membership rows and add a reverse index
for faster shape removal.

Why not: It improves removal latency but increases memory for a structure that
is already too large.

### Alternative 3: Tombstone Removed Shapes

Description: Mark shapes inactive, leave their membership rows behind, and clean
later.

Why not: This can be an emergency operational mitigation, but it adds cleanup
debt and keeps routing dependent on stale rows.

### Alternative 4: One Global Widened Filter

Description: Keep one shared widened view and route conservatively until all
consumers catch up.

Why not: It avoids per-time reads, but slow or stalled consumers can keep routing
broad indefinitely. It also relies heavily on downstream filtering and loses the
exact participant-time model.

### Alternative 5: Full Differential Dataflow Runtime

Description: Introduce a general arrangement/timestamp/differential runtime for
subquery state.

Why not: The conceptual model is relevant, but Electric only needs a narrow
versioned membership arrangement for this problem. A full runtime would add
unnecessary implementation and operational surface area.

## Open Questions

| Question | Options | Resolution Path |
|----------|---------|-----------------|
| What exactly defines a cohort? | dependency shape handle; filter node; canonical dependency query | Start conservative and instrument sharing opportunities. |
| Where should value history live? | shared ETS tables; cohort-owned ETS table; owner process state | Benchmark cleanup and routing locality before choosing. |
| What is the best history layout? | in-row short history; row-per-transition ordered set; hybrid | Prototype both under repeated-move workloads. |
| How many active logical times occur in production? | usually 1-2; many under slow consumers | Add telemetry before full integration. |
| Can `values_at(time)` be rebuilt cheaply enough? | scan histories; cache by time; materialize arrays per active time | Start with scan, add cache only if measured. |
| How should readiness work for new participants during active moves? | pin latest; fallback until safe; pin separate time | Define explicit readiness contract and test active registration. |
| How should original string values be retained? | value history payload; materializer event payload; side table | Decide during materializer integration. |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Active logical times grow large | Track active time count and age; alert on stuck pins; force fallback or invalidation if needed. |
| Per-value histories grow long | Compact by minimum pinned time; add repeated-move benchmarks; consider row-per-transition layout. |
| `values_at(time)` is too slow for large views | Cache active time enumerations or store cohort-owned arrays if measurements require it. |
| Cohort key merges unlike views | Start with conservative keys and assert readiness before participant leaves fallback. |
| Exact evaluation accidentally uses latest time | Make participant time explicit in APIs and add tests for two-time divergence. |
| Empty cohort cleanup blocks replication | Detach routing synchronously and reclaim value history off the critical path. |

## Definition of Success

The design is successful if:

- memory for `S` consumers sharing `V` dependency values scales near
  `O(V + S)` in steady state;
- memory during moves scales with moved value histories and active times, not
  moved values times divergent participants;
- shape removal is independent of the full dependency view size;
- existing subquery move correctness tests continue to pass;
- routing and exact membership stay within acceptable microsecond budgets;
- compaction prevents unbounded history growth in realistic traffic.

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-05-13 | robacourt | Initial logical-time RFC with isolated prototype and benchmark results. |
