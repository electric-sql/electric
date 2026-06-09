---
"@core/sync-service": patch
---

Fix a `KeyError: key :consider_flushed? not found in: nil` crash in `Electric.Shapes.Consumer`. `consumer_can_suspend?/1` now refuses to suspend while a transaction is pending, so the consumer hibernates instead and suspends only once the transaction completes.
