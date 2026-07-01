---
'@core/sync-service': patch
---

Fix shapes processing duplicate operations after a server restart. On restart the
persistent replication slot can replay transactions the consumer has already
applied and persisted. The multi-fragment path skipped these via
`fragment_already_processed?/2`, but the single-fragment complete-transaction fast
path did not — so a replayed transaction was re-written to the shape log
(duplicating ops) and re-notified to dependent subquery materializers, which
re-applied it and crashed. The consumer now skips a complete transaction already
at or below its persisted `latest_offset` on every path.
