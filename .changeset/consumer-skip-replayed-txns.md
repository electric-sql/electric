---
'@core/sync-service': patch
---

Fix shapes processing duplicate operations after a server restart. On restart the
persistent replication slot can replay transactions the consumer has already
applied and persisted. The consumer now skips any transaction already at or below
its persisted offset, so a replayed transaction is no longer re-written to the
shape log (duplicating ops) or re-notified to dependent subquery materializers
(which would re-apply it and crash).
