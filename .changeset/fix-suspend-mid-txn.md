---
"@core/sync-service": patch
---

Fix a `KeyError: key :consider_flushed? not found in: nil` crash in
`Electric.Shapes.Consumer`. A shape consumer could suspend (terminate to save
memory) on its idle timeout while still holding a `pending_txn` for an
in-flight multi-fragment transaction. When a later fragment of that transaction
arrived, a fresh consumer was started and received a `has_begin?: false`
fragment with no pending transaction, crashing in `process_txn_fragment/2`.
`consumer_can_suspend?/1` now refuses to suspend while a transaction is pending,
so the consumer hibernates instead and suspends only once the transaction
completes.
