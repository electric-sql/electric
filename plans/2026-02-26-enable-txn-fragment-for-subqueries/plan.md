# Restore `write_unit=txn_fragment` for shape consumers

## Context

PR #3783 introduced the infrastructure for streaming transaction fragments directly to storage (`write_unit=txn_fragment`) instead of buffering entire transactions in consumer memory. This dramatically reduces memory usage for large transactions (9GB → 500MB in benchmarks).

However, correctness issues emerged with subquery shapes, and the final version of #3783 sets `write_unit=txn` for all shapes to ship a safe baseline. All the fragment-streaming code paths remain in the codebase but are currently unreachable.

This issue tracks re-enabling `write_unit=txn_fragment`, starting with the simpler case (standalone shapes) and eventually covering all shapes.

## Phase 1: Restore `txn_fragment` for standalone shapes (no subquery dependencies)

Standalone shapes have no materializer subscribers and no shape dependencies. The fragment-streaming code path was already working for these shapes before it was disabled.

- [ ] In `State.initialize_shape/3`, set `write_unit=txn_fragment` for shapes where `shape_dependencies == []` and `is_subquery_shape? == false`
- [ ] Run the oracle property-based tests for standalone shapes and confirm no new failures compared to `main`
- [ ] Verify memory usage improvement on large transactions with a manual or automated benchmark

## Phase 2: Restore `txn_fragment` for inner (dependency) subquery shapes

For inner shapes each consumer process has a materializer process subscribed it. Outer shape's consumer is in turn subscribe to the inner shape's materializer to correctly handle move-ins and move-outs. Fragment streaming for these shapes requires the materializer to correctly defer event processing until all changes for the current transaction have been processed. Or, and this needs verification, materializer and consumer logic could be made to work with fragments from incomplete transactions, delaying issuing DB queries until the right moment at the most appropriate place in the code.

- [ ] Fix the materializer subscription race: in `subscribe_materializer`, (AI hallucations: ~~return the last **committed** offset from storage (`Storage.fetch_latest_offset`) instead of `state.latest_offset`, which can be a mid-transaction fragment offset ahead of the committed boundary~~)
  - File: `lib/electric/shapes/consumer.ex`, `handle_call({:subscribe_materializer, ...})`
- [ ] Set `write_unit=txn_fragment` for shapes with `is_subquery_shape? == true` (and no `shape_dependencies` of their own)
  - At this point we can remove the `is_subquerye_shape?` flag from the code
- [ ] Verify the `commit: false` / `commit: true` deferred notification path is exercised end-to-end: `write_txn_fragment_to_storage` calls `notify_materializer_of_new_changes(state, changes, commit: false)` per fragment, and `maybe_complete_pending_txn` calls with `commit: true` at commit time
- [ ] Add test coverage: inner shape with `write_unit=txn_fragment` and a materializer subscriber receives a multi-fragment transaction; the materializer's `pending_events` accumulate across fragments and only flush on commit
- [ ] Run oracle tests for shapes-with-subqueries and confirm no regressions

## Phase 3: Restore `txn_fragment` for outer (parent) subquery shapes

Outer shapes have `shape_dependencies != []` and process materializer events (move-ins/move-outs) as part of their transaction handling. This is the hardest case.

- [ ] Audit `write_txn_fragment_to_storage` for move-in/move-out correctness — currently it does not account for converting operations based on move-in/move-out status. The full-txn path in `handle_txn` does this via `convert_changes_for_subquery_shape`, which needs an equivalent in the fragment path
- [ ] Decide on the approach for materializer events arriving mid-fragment-write: when the outer shape writes fragments to storage, materializer events from inner shapes may arrive between fragments of the same transaction. These events need to be buffered and applied at commit time, similar to how the inner shape's materializer defers with `commit: false`
- [ ] Implement fragment-level change conversion that accounts for the shape's subquery state (or/not with subquery flags)
- [ ] Add test coverage: outer shape with dependencies receives a multi-fragment transaction while materializer events arrive from inner shapes mid-transaction
- [ ] Run full oracle test suite and confirm parity with `write_unit=txn`

## Additional items

- [ ] Handle the edge case where a standalone consumer with `write_unit=txn_fragment` is later adopted as an inner shape for a newly created outer subquery shape — may need to either restart the consumer or gracefully switch `write_unit` between transactions

## References

- PR #3783: initial implementation
- Issue #3415: original issue ("Avoid holding whole transaction in consumer memory")
- PR #3783 review comment (review iteration 9, 2026-02-24): documents the materializer subscription race and remaining gaps
