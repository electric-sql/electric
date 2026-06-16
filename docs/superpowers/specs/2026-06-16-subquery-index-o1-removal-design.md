# SubqueryIndex O(1) shape removal — design

**Date:** 2026-06-16
**Issue:** [#4279](https://github.com/electric-sql/electric/issues/4279) — O(n) shape removal in the v1.6 Subquery Index
**Scope:** `packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex` — internal storage only.

## Problem

Removing a subquery shape degraded from O(1) (v1.5) to O(n) (v1.6), where n scales with
the number of shapes in the index. In production (Autoarc) this blocked replication
processing on "Materializer shape invalidated" events and caused significant WAL lag.

The Subquery Index is a single `:bag` ETS table holding heterogeneous rows. The two
removal entry points each scan:

1. **`unregister_shape/2`** runs `:ets.match_delete` with **partially-bound keys**
   (`{:membership, handle, :_, :_}`, `{:polarity, handle, :_}`,
   `{:shape_dep_node, handle, :_}`). On a `:bag` (hash) table a partially-bound key
   cannot use the hash, so each is a **full-table scan** → O(total rows) = O(total shapes).
2. **`remove_shape/5`** match-deletes a shape's entry from per-node bag buckets
   (`{:node_shape, node}`, `{:node_fallback, node}`, `{:node_negated_shape, node}`) →
   O(shapes on that node); and `delete_node_members/5` match-deletes
   `{:node_positive_member, node, :_}` (partially-bound key) → **full-table scan** of all
   member rows = O(shapes × values), the dominant cost in the **seeded** production case.

### Root cause

A `:bag`/`:set` (hash) table avoids a scan **only when the delete key is fully bound**.
An `:ordered_set` (tree) avoids a scan whenever the delete key has a **bound prefix** —
the match-spec compiler turns the bound prefix into a key range and limits traversal.

### Measured evidence (reductions; the project's perf proxy)

Delete one shape's rows, scaling total rows in the table:

| total rows | `:bag` partial-key `match_delete` | `:ordered_set` prefix `select_delete` |
| ---------- | --------------------------------- | ------------------------------------- |
| 1,000      | 9,340                             | 9                                     |
| 10,000     | 153,560                           | 9                                     |
| 50,000     | 795,807                           | 9                                     |

Seeded production scenario — remove **one** shape with a fixed view of V=20 values, scaling
N = shapes sharing each value (the "thousands of shapes per value" case):

| N (shapes per value) | `:bag` `delete_node_members` scan | `:ordered_set` point-deletes |
| -------------------- | --------------------------------- | ---------------------------- |
| 100                  | 5,328                             | 87                           |
| 1,000                | 78,246                            | 87                           |
| 5,000                | 78,528                            | 87                           |

Hot-read cost is **not** regressed by `:ordered_set` (50,000 rows):

| hot read                                          | `:bag`/`:set` today | `:ordered_set`                            |
| ------------------------------------------------- | ------------------- | ----------------------------------------- |
| member-routing lookup (≈4× per `affected_shapes`) | 24 ea               | 13 ea (faster — match-spec projects in C) |
| exact `member?` point check                       | 4.006               | 4.007                                     |
| table memory @ 50k member rows                    | 752k words          | 650k words (lower)                        |

## Goals / non-goals

**Goals**

- Removal cost = **O(V_shape · log n)**, where V*shape is the \_removed shape's own* view
  size — independent of total shapes, shapes-on-node, and shapes-per-value.
- No regression to hot reads (`affected_shapes`, `member?`).
- Memory not increased (measured lower).
- Pure internal change: every public function signature and all externally-observable
  behavior preserved; existing non-perf tests are the behavioral contract.

**Non-goals**

- True constant-time removal regardless of the removed shape's own view size (would need
  lazy tombstone GC — over-engineering).
- A dedicated memory-reduction pass on the index (tracked separately, per maintainer
  direction). This change happens to be memory-neutral-to-lower but does not target it.
- Changing the public API, caller contracts, or the routing subsystem outside the index.

## Design

Replace the single `:bag` table with a single `:ordered_set` table (same per-stack
lifecycle, same `new/1`/`for_stack/1`, same `:public` access). For every row, **lift the
discriminating fields out of the value tuple into the key**, ordered so that:

- every hot read is a point lookup or a leading-prefix `select`, and
- every bulk delete ("all rows for this shape / this node / this shape-on-node") is a
  leading-prefix `select_delete`, and
- every point write/delete (`add_value`/`remove_value`) is an exact-key op.

No reverse indexes are added; fields are relocated, not duplicated.

### Key layout

Tag atom leads every key, so the tree is partitioned per row-type, then ordered by the
fields shown. `%` denotes the stored value.

| Row             | `:ordered_set` key                                          | value                   | hot read                                        | delete-all-for-shape                              |
| --------------- | ----------------------------------------------------------- | ----------------------- | ----------------------------------------------- | ------------------------------------------------- |
| membership      | `{:membership, handle, ref, value}`                         | `true`                  | `member?` point                                 | prefix `{:membership, handle, :_, :_}`            |
| polarity        | `{:polarity, handle, ref}`                                  | polarity                | point                                           | prefix `{:polarity, handle, :_}`                  |
| fallback        | `{:fallback, handle}`                                       | `true`                  | point                                           | point                                             |
| shape→node      | `{:shape_node, handle, node_id, branch}`                    | `{dep, pol, next_cond}` | enum by handle (prefix)                         | prefix `{:shape_node, handle, :_, :_}`            |
| shape+dep→node  | `{:shape_dep_node, handle, dep, node_id, branch}`           | `{pol, next_cond}`      | **hot** enum by `(handle,dep)` prefix           | prefix `{:shape_dep_node, handle, :_, :_, :_}`    |
| node→shape      | `{:node_shape, node_id, shape, branch}`                     | `{dep, pol, next_cond}` | cold enum by node; `node_empty?` = range-exists | point delete                                      |
| node negated    | `{:node_negated_shape, node_id, shape, next_cond}`          | `true`                  | **hot** enum by node (prefix)                   | point delete                                      |
| node fallback   | `{:node_fallback, node_id, shape, next_cond}`               | `true`                  | **hot** enum by node (prefix)                   | `mark_ready`: prefix `(node,shape)`; point delete |
| node pos member | `{:node_positive_member, node_id, value, shape, next_cond}` | `true`                  | **hot** enum by `(node,value)` prefix           | derived point-deletes (see below)                 |
| node neg member | `{:node_negated_member, node_id, value, shape, next_cond}`  | `true`                  | **hot** enum by `(node,value)` prefix           | derived point-deletes (see below)                 |
| node meta       | `{:node_meta, node_id}`                                     | `%{testexpr: …}`        | point                                           | deleted when node empties                         |

Within a tag all keys share the same arity, so Erlang term ordering (which compares tuple
arity first, then element-wise) gives correct contiguous prefix ranges. The
prefix-`select_delete` range optimization is verified by the measurements above.

### The one non-trivial removal: node member rows

`node_positive_member`/`node_negated_member` are keyed `(node, value, shape, next_cond)`
so the hot `affected_shapes` read can prefix on `(node, value)`. That ordering means a
shape's member rows are **not** a contiguous range (value precedes shape), so they cannot
be removed with a single prefix `select_delete`.

Resolution (no extra index, no scan, no canonicalization risk): `remove_shape/5` is called
per node with the full `optimisation` map, which carries `subquery_ref`, `dep_index`, and
`polarity` (`where_condition.ex:201–215`). So for the node being removed we:

1. enumerate the shape's own values for that node's exact ref via the membership prefix
   `{:membership, handle, optimisation.subquery_ref, :_}` (O(V_node)), and
2. point-delete the polarity-correct member row for each value:
   `{:node_positive_member | :node_negated_member, node_id, value, shape, next_cond}`.

This touches only this shape's rows — never the other shapes sharing a value. The membership
rows themselves are then removed by `unregister_shape/2`'s prefix `select_delete` on
`{:membership, handle, :_, :_}`.

Three properties make this correct, not fragile:

- **Superset invariant (by construction).** Every `node_*_member` row is written only by
  `add_value/5` (`subquery_index.ex:254–264`), which in the same call always writes the
  paired membership row (line 268). `seed_membership/5` goes through `add_value/5` too. So
  `membership ⊇ node-member` for a shape's every ref — enumerating membership covers every
  member row. (Extra membership values from a _different_ ref/dep produce point-deletes of
  keys that don't exist → harmless no-ops; scoping by `optimisation.subquery_ref` avoids
  even those.)
- **Exact value terms (no canonicalization).** We delete using the value term read _out of_
  the membership row, i.e. the identical term `add_value` inserted — there is no
  reconstruction, so no `5` vs `5.0` / binary-vs-charlist mismatch is possible.
- **Ordering precondition (load-bearing, documented + tested).** `Filter.remove_shape`
  (`filter.ex:121–143`) runs `WhereCondition.remove_shape` → `SubqueryIndex.remove_shape`
  (this derivation) **before** `maybe_unregister_subquery_shape` →
  `SubqueryIndex.unregister_shape` (which deletes membership). Membership is therefore still
  present when derivation runs. This is a hard precondition: **`unregister_shape` must run
  after all `remove_shape` calls for the shape.** A regression test asserts a full
  `Filter.remove_shape` of a seeded shape leaves zero `node_*_member` rows.

**Alternative considered and rejected:** a second member index keyed
`{:shape_node_member, shape, node, value}` makes removal a contiguous prefix
`select_delete` with no membership-lifetime dependency. It is correctness-robust but
**doubles the single most memory-heavy structure** (the node-member explosion the issue
calls out). Given the maintainer's preference to not increase memory and to defer memory
work, and that ref-scoping makes derivation exact, derivation is preferred.

### Per-function impact (all signatures unchanged)

- `new/1` — create `:ordered_set` instead of `:bag` (keep `:public`, `:named_table` when
  `stack_id` given).
- `register_shape/3`, `add_shape/5` — insert the relocated-key rows.
- `unregister_shape/2` — replace 3 partial-key `match_delete` scans with prefix
  `select_delete`s (`membership`, `polarity`, `shape_dep_node`, `shape_node`) + point
  delete of `fallback`.
- `remove_shape/5` — point-delete `node_shape`/`node_negated_shape`/`node_fallback` rows;
  remove member rows via the derived point-deletes above; `node_empty?` becomes a
  range-exists check; delete `node_meta` when empty.
- `add_value/5`, `remove_value/5` — exact-key insert/delete (the `(node,value,shape,next)`
  member key + the `(handle,ref,value)` membership key); read nodes via `shape_dep_node`
  prefix.
- `mark_ready/2` — delete `fallback` point; for each node (from `shape_node` prefix) delete
  the shape's `node_fallback` rows via `(node,shape)` prefix.
- `affected_shapes/4`, `all_shape_ids/3`, `positions_for_shape/2`, `has_positions?/2` —
  reads rewritten from `:ets.lookup`-by-key to prefix `:ets.select` projecting the same
  tuples (measured equal-or-faster).
- `member?/4`, `membership_or_fallback?/4`, `fallback?/2`, `polarity_for_shape_ref` — point
  lookups, unchanged semantics.

Private helpers (all currently `:ets.lookup` on a fully-bound bag key; each becomes a
prefix `:ets.select`):

- `nodes_for_shape/2` (`:ets.lookup({:shape_node, handle})`, line 428) → prefix select
  `{:shape_node, handle, :_, :_}`, projecting `{node_id, dep, pol, next_cond, branch}` from
  key+value. Underpins `has_positions?`, `positions_for_shape`, `mark_ready`,
  `node_shape_entry_for_shape`.
- `nodes_for_shape_dependency/3` (line 432) → prefix select
  `{:shape_dep_node, handle, dep, :_, :_}`. Hot (drives `add_value`/`remove_value`).
- `node_shape_entry_for_shape/4` (line 438) → prefix select on
  `{:shape_node, handle, node_id, :_}`. Must preserve existing behavior: it still drives the
  **existence check** (`nil → :deleted`, line 170–172) and the `branch_key` match, and
  yields `next_cond` for the member/structural deletes. (`dep_index`/`ref` also come from
  `optimisation`, but the existence/branch check must not be dropped.)
- `all_node_shapes/2` (line 454) → prefix select `{:node_shape, node_id, :_, :_}` with a
  match-spec spanning **key and value**: project `{shape, next_cond}` from `shape` (key) and
  `next_cond` (value). Cold path (`affected_shapes` `:error` branch).
- `node_empty?/2` (line 450) → range-exists: `:ets.select(table, ms, 1)` (or `:ets.next`)
  on the `{:node_shape, node_id, :_, :_}` prefix.
- `values_for_key/2` reads of `{:node_negated_shape, node_id}` and `{:node_fallback, node_id}`
  (line 488) → prefix selects `{:node_negated_shape, node_id, :_, :_}` /
  `{:node_fallback, node_id, :_, :_}` projecting `{shape, next_cond}` entirely from the key
  (value is `true`). These are **node-only** prefixes returning all matching rows — same
  result-set size as today's bag lookup, same `select` mechanism benchmarked for members
  (cost scales with result size either way; no regression).
- `ensure_node_meta/3`, `evaluate_node_lhs/3` — `node_meta` point ops, unchanged.

## Invariants (must hold; tested)

1. **No concurrent writer during removal (the load-bearing guarantee).** The shape's
   consumer is the _only_ process that writes membership/`node_member` rows (via
   `add_value`/`remove_value`/`seed_membership`). `ShapeCleaner.remove_shape_immediate`
   stops it **synchronously and to completion** — `with :ok <- Consumer.stop(...)`, a
   blocking `GenServer.call` (`shape_cleaner.ex:165`, `consumer.ex:98`) — _before_ the only
   path that reaches `Filter.remove_shape` (`ShapeLogCollector.remove_shape`, run later on
   the collector process). This matters because `add_value/5` writes the `node_member` row
   **before** the `membership` row (`subquery_index.ex:251–269`): there is a transient
   in-call window where `node_member ⊄ membership`. Derivation is correct only because no
   such in-flight write can overlap removal — the sole writer is provably dead first. A
   future refactor that let `Filter.remove_shape` run while a consumer is still alive (or
   reordered cleanup to remove from the filter before stopping the consumer) would
   reintroduce the orphan bug. `remove_value` deletes in the safe order (`node_member`
   first), and a terminating consumer tears down rather than seeds, so neither produces the
   dangerous window.
2. **Remove-before-unregister (in-function).** Within `Filter.remove_shape`,
   `WhereCondition.remove_shape` → `SubqueryIndex.remove_shape` (derivation) runs before
   `maybe_unregister_subquery_shape` → `unregister_shape` (membership deletion), so
   membership rows survive to drive derivation (`filter.ex:121–143`).
3. **Membership ⊇ node-member** per `(shape, ref)` _at rest_ (between consumer writes),
   guaranteed by `add_value/5` writing both in one call; relied on only because Invariant 1
   rules out observing an in-flight write.
4. **Node drains atomically across row types.** Within `remove_shape/5` the order is: delete
   this shape's member/fallback/negated rows → delete its `node_shape` row → only then
   `node_empty?` (range-exists on remaining `node_shape` rows) → delete `node_meta` if empty.
   `node_meta` is deleted iff no `node_shape` rows remain (`node_empty?` consults
   `node_shape` rows _only_ — member rows are never a liveness signal, so a surviving shape
   with an empty seeded view, which has a `node_shape` row but zero member rows, correctly
   keeps the node alive). Since each shape's member rows are deleted in the same
   `remove_shape` call that deletes its `node_shape` row, no orphan member rows can outlive
   `node_meta`. A test asserts a node with several seeded shapes, removed one-by-one, ends
   with **zero** rows of every type for that `node_id`.

## Testing

Existing `subquery_index_test.exs`, `filter_test.exs`, and consumer tests are the
behavioral contract and must stay green unchanged.

**Performance tests assert _flatness_, not a ceiling.** A fixed `< @max_reductions` budget
at one size would also pass for an O(log n) — or a cheap-but-linear — implementation. Each
test measures removal reductions at two well-separated sizes (e.g. `N` and `50·N`) and
asserts the delta is within a small constant (noise), proving independence from that
dimension. The goal names three independence dimensions; there is one test each:

1. **O(1) in total shapes.** Seeded shapes on distinct nodes, small view each; remove one at
   total `N` vs `50·N`; assert removal reductions flat. Guards `unregister_shape` +
   structural-row removal as the whole table grows.
2. **O(1) in shapes-on-node.** Seeded shapes on **one** node, distinct values; remove one
   shape at `N` vs `50·N` shapes-on-node; assert flat. Guards the per-node bucket scans
   (`node_shape`/`node_fallback`/`node_negated_shape`).
3. **O(1) in shapes-per-value (production repro).** Many shapes sharing the **same** values
   on one node, each seeded; remove one shape with a fixed small view at `N` vs `50·N`
   per-value fan-out; assert flat. This is the case today's `delete_node_members` scan fails.

Plus a positive control and the invariant guards (these run as ordinary, non-perf tests):

4. **Cost scales with `V_shape`.** Remove a shape seeded with `V` vs `50·V` values; assert
   reductions grow ~linearly with `V` — pins the complexity class as O(V_shape), not a
   budget that hides regressions.
5. **No orphan rows (invariants 1–4).** A full `Filter.remove_shape` of a seeded shape leaves
   zero `node_*_member`/membership rows; removing several seeded shapes from one node
   one-by-one ends with zero rows of every type for that `node_id` (assert via
   `:ets.tab2list` filtered by `node_id`).
6. **Retained unseeded tests** (the two already added) — keep as guards on
   `unregister_shape`'s structural partial-key scans even without membership.

All four current `Filter`-level perf tests for the equality/inclusion/OR optimisations
remain unaffected (they do not use subqueries).

## Risks / edge cases

- **Term ordering / arity.** Each tag's keys are uniform arity → prefix ranges are
  contiguous (Erlang compares tuple arity first, then element-wise). The bound prefix
  (`node_id`, `value`) is compared by exact term equality; `node_id` is a `{reference(),
term()}` 2-tuple and `value` a typed term, both internally type-consistent per node in
  practice, so range derivation stays tight. New key tuples must keep uniform arity per tag.
- **Value canonicalization — not a risk here.** Derived member deletes reuse the exact value
  term stored in the membership row (read, not reconstructed), so the delete key is
  byte-identical to the insert key. No `5`/`5.0`/binary-vs-charlist drift is possible.
- **`select_delete` range optimization** is load-bearing; verified by measurement (flat 9
  reductions vs linear). Implementation must use a bound prefix, not a leading wildcard.
- **Node-drain atomicity** (orphan `node_meta`/member rows) — addressed by the within-
  `remove_shape` ordering in Invariant 4 and guarded by test 5.
- **Concurrency.** Table stays `:public`: consumers write (`add_value`/`remove_value`),
  filter reads (`affected_shapes`). `:ordered_set` ops are atomic per-op as `:bag` was. A
  single ordered_set may contend more under heavy concurrent writes than a bag; this
  matches existing defaults (no `write_concurrency` set today) and is out of scope —
  flagged to monitor, not addressed here.
- **Uniqueness.** `:ordered_set` forbids duplicate keys; relocated keys include enough
  fields (`branch`, `next_cond`) to keep previously-distinct `:bag` objects distinct.

## Appendix — reproduction of measurements

The three probes above were run via `mix run --no-start` against fresh ETS tables, using
`:erlang.process_info(self(), :reductions)` deltas. They are not committed; the two
`:performance` tests are the durable regression guard.
