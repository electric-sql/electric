# Implementation Plan: Simple Subqueries With DNF

Related:
- `./simple-subqueries-with-dnf-rfc.md`
- `./simple-subqueries.md`

Existing assets we should reuse:
- `Electric.Replication.Eval.Decomposer`
- `Electric.Replication.Eval.SqlGenerator`

## Goal

Implement the RFC in staged slices, keeping the current splice-at-boundary
model, using DNF whenever subqueries are involved, and preserving the current
`NOT` + subquery invalidation / 409-on-move behaviour.

## Ground Rules

- Do not add DNF metadata to `Shape`.
- Keep `Shapes.Filter` conservative for now.
- Keep buffering in memory.
- Keep one global move queue per shape.
- For move-in queries, do not use live subqueries in the SQL. Use parameters
  derived from the current in-memory subquery views.

## High-Level Shape

The implementation breaks into five runtime concerns:

1. compile a DNF sidecar plan from a shape
2. compute row metadata from that plan:
   - inclusion
   - tags
   - `active_conditions`
3. generate parameterized SQL for:
   - move-in queries
4. generalize the subquery consumer state machine from one dependency to N
5. teach the materializer to handle:
   - multiple tags per row
   - real `active_conditions`
   - `move-in` and `move-out` broadcasts

## Stage 1: DNF Sidecar Plan

Create a sidecar runtime plan, for example `Electric.Shapes.DnfPlan` or
`Electric.Shapes.Consumer.DnfPlan`, built from:

- `shape.where.eval`
- `shape.shape_dependencies`
- `shape.shape_dependencies_handles`
- `shape.subquery_comparison_expressions`

The plan should contain at least:

- `disjuncts`
- `position_count`
- `positions`
- `dependency_positions`
- `dependency_disjuncts`
- per-position SQL AST / SQL text
- per-position tag metadata

Each position should know:

- whether it is a subquery position
- which dependency handle it belongs to, if any
- how to evaluate its boolean value for `active_conditions`
- how to produce its tag slot

Important validation:

- if the decomposition contains any negated subquery position, mark the plan as
  "unsupported on move" and keep the current invalidation semantics
- do not reject the shape at parse time; this is the existing 409-on-move path

Suggested tests:

- single-subquery shape
- `x IN sq1 OR y IN sq2`
- `(x IN sq1 AND status = 'open') OR y IN sq2`
- `x IN sq1 AND y IN sq2`
- composite-key subquery positions
- nested subqueries still compile level by level

## Stage 2: Row Metadata Projection

Replace the current "all tags true => `active_conditions = [true, ...]`" logic
with a plan-driven projection step.

Current code path to replace:

- `Shape.convert_change/3`
- `Shape.fill_move_tags/4`
- `Shape.make_active_conditions/1`

Implement a helper that, given:

- a `DnfPlan`
- a row
- a view map for direct subqueries

computes:

- `active_conditions`
- whether the row is included
- `tags` for the currently satisfied disjuncts

For updates, it must compute both old and new row metadata so we can derive:

- old inclusion vs new inclusion
- `removed_tags`

Important design point:

- `tags` are structural row metadata
- subquery moves change `active_conditions`, not the tags themselves
- tags only change when row contents change or the set of satisfied disjuncts
  changes because of the row itself

Implementation direction:

- keep the no-subquery fast path for shapes without dependencies
- for shapes with dependencies, derive inclusion from the DNF projection rather
  than calling `WhereClause.includes_record?/3` separately and then filling tags
  afterwards

Suggested tests:

- insert/update/delete conversion across multiple disjuncts
- update that changes which disjuncts are satisfied
- correct `removed_tags`
- correct `active_conditions` for row-only predicates and subquery predicates
- single-subquery regression

## Stage 3: Parameterized SQL Generation

Generalize `Electric.Shapes.Querying` so snapshot and move-in queries are built
from the DNF sidecar plan instead of the current `shape.where.query` string.

Current code paths to replace or split:

- `Querying.stream_initial_data/5`
- `Querying.query_move_in/5`
- `Querying.json_like_select/4`
- `Querying.make_tags/3`

### 3A. Initial snapshot

For subquery shapes, initial snapshot queries should:

- stay on the existing live-subquery path
- compute row inclusion in SQL
- compute `active_conditions` in SQL
- compute `tags` in SQL

This likely needs a new query builder returning:

- SQL string
- params list

only if the existing snapshot JSON builder cannot be extended cleanly.

### 3B. Move-in query

Build move-in SQL from the DNF plan:

- candidate predicate from impacted disjuncts, with triggering positions
  replaced by `move_in_values`
- exclusion predicate from only the disjuncts that could already have been true
- `active_conditions` computed against `views_after_move`
- `tags` computed for the inserted rows

The move-in query should return rows ready to append to the log with correct
headers, not partially interpreted state.

### 3C. Move broadcasts

Add control-message builders for:

- `move-in`
- `move-out`

using:

- DNF position indexes
- hashed subquery values

Suggested tests:

- generated SQL / params for `x IN sq1 OR y IN sq2`
- generated SQL / params for `(x IN sq1 AND status='open') OR y IN sq2`
- broadcast payloads for single-column and composite-key subquery positions

## Stage 4: Generalize Subquery Runtime

Rework the current single-dependency subquery state machine into an N-dependency
runtime.

Current code paths to generalize:

- `lib/electric/shapes/consumer/state.ex`
- `lib/electric/shapes/consumer.ex`
- `lib/electric/shapes/consumer/subqueries.ex`
- `lib/electric/shapes/consumer/subqueries/steady.ex`
- `lib/electric/shapes/consumer/subqueries/buffering.ex`

### 4A. Initialization

Today `initialize_subquery_runtime/1` only handles:

- exactly one dependency
- no OR-with-subquery
- no NOT-with-subquery

Change this to:

- initialize DNF runtime for any shape with subqueries
- wait for all dependency materializers
- fetch all current link-value views
- keep the existing invalidation path only for `NOT` + subquery shapes

### 4B. Runtime state

Replace single-dependency fields like:

- `dependency_handle`
- `subquery_ref`
- `subquery_view`

with:

- `views`
- `dependency_handle_to_ref`
- `dnf_plan`
- trigger-specific move fields in buffering state

Queue items should become something like:

- `{:move_in, dependency_handle, values}`
- `{:move_out, dependency_handle, values}`

### 4C. Splice flow

Keep the current splice machinery, but operate on full view maps:

- pre-boundary buffered txns use `views_before_move`
- move-in control messages are appended to the outer shape's log at the splice
  point
- move-in query rows follow with `views_after_move`
- post-boundary buffered txns use `views_after_move`

The exact ordering at the splice point should be:

1. pre-boundary buffered transactions
2. move-in control messages for already-present rows
3. move-in query rows for newly visible rows
4. post-boundary buffered transactions

That ordering matches the `active_conditions` semantics:

- existing rows learn the new true positions at the boundary
- newly visible rows arrive with already-correct metadata

### 4D. Remove invalidation cases

Once the DNF runtime is in place, remove the current invalidation for:

- OR + subquery
- multiple sibling subqueries

Keep invalidation for:

- `NOT` + subquery

Suggested tests:

- state machine for multiple dependencies
- serialized move queue across dependencies
- OR case no longer invalidates
- `NOT` + subquery still invalidates on move
- single-subquery regression

## Stage 5: Materializer Upgrade

This is the most important supporting change, because the current materializer
assumes:

- one move tag per row
- `move-out` means remove the row
- `pos` is ignored
- `active_conditions` are not parsed or stored

Current code paths:

- `lib/electric/shapes/consumer/materializer.ex`

### 5A. Stored row state

Change the materializer's row index to retain enough metadata to re-evaluate
inclusion when broadcasts arrive:

- row value
- tags
- `active_conditions`
- whether the row is currently included

### 5B. Tag index

Replace the current naive tag index with a position-aware index, for example:

- `{position, hash} -> MapSet<key>`

This allows `move-in` and `move-out` broadcasts to target only the rows whose
tag contains the matching subquery value at that position.

### 5C. Broadcast handling

Add `move-in` event support to the decoder and runtime.

On broadcast:

- look up matching keys by `(position, hash)`
- flip the relevant `active_conditions[position]`
- re-evaluate row inclusion from `tags` + `active_conditions`
- only emit materializer `move_in` / `move_out` value events when the row's
  inclusion actually changes

This is what makes `x IN sq1 OR y IN sq2` work:

- move-in on `sq1` can activate an already-present row without reinserting it
- move-out on `sq1` does not remove the row if the `sq2` tag still evaluates
  true

Suggested tests:

- multiple tags per row
- `move-in` broadcast on already-present row
- `move-out` broadcast that does not remove the row because another disjunct
  still holds
- `move-out` broadcast that does remove the row because no disjunct remains true
- composite-key tag indexing

## Stage 6: Consumer / Log Integration

Wire the new pieces through the consumer and log-writing path.

Current code paths:

- `lib/electric/log_items.ex`
- `lib/electric/shapes/consumer.ex`

Work items:

- make sure `active_conditions` are preserved on all row operations
- add `move-in` control message append path
- keep `move-out` control messages, but now interpret them as position flips,
  not tag deletion
- make sure new control messages flow through both:
  - storage-backed materializer replay
  - live `new_changes` notifications

Suggested tests:

- log item encoding includes real `active_conditions`
- materializer replay from stored log sees `move-in` and `move-out`
- no protocol regression for existing clients

## Stage 7: End-to-End Test Matrix

Add higher-level coverage once the pieces exist.

### Core scenarios

- `x IN sq1 OR y IN sq2`
- `(x IN sq1 AND status = 'open') OR y IN sq2`
- `x IN sq1 AND y IN sq2`
- row already present via one disjunct, then another disjunct moves in
- row loses one active position but remains via another disjunct
- row loses its last active reason and leaves the shape

### Regressions

- current single-subquery move-in path
- current single-subquery move-out path
- composite-key subqueries
- nested subqueries
- `NOT` + subquery still invalidates / 409s on move

### Suggested test locations

- `test/electric/replication/eval/` for DNF plan / SQL generation
- `test/electric/plug/router_test.exs` for a router-level integration test of
  `x IN subquery1 OR y IN subquery2` covering:
  - initial snapshot
  - move-in that adds rows via one side
  - move-in on one side for rows already present via the other side
  - move-out that removes one reason but keeps the row
  - move-out that removes the last remaining reason
- `test/electric/shapes/consumer/subqueries_test.exs`
- `test/electric/shapes/consumer_test.exs`
- `test/electric/shapes/querying_test.exs`
- `test/electric/shapes/shape_test.exs`
- `test/electric/shape_cache_test.exs`

## Recommended Landing Order

1. DNF sidecar plan + unit tests
2. row metadata projection (`tags` + real `active_conditions`)
3. parameterized snapshot SQL and move-in SQL generation
4. materializer support for multiple tags and move broadcasts
5. generalized consumer subquery runtime
6. remove OR / multiple-subquery invalidation
7. end-to-end regressions

This order keeps the early work local and testable, and delays the invasive
consumer-state change until the metadata, SQL, and materializer semantics are
already nailed down.

## Prototype Notes To Keep

- broad `Shapes.Filter` routing is acceptable
- broad `%LsnUpdate{}` broadcast is acceptable
- in-memory buffering is acceptable
- performance is secondary to getting the semantics readable and consistent
