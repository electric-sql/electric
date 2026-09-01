---
'@core/sync-service': patch
---

Promote an already-running standalone shape consumer to whole-transaction writes when a subquery materializer subscribes to it. If a fragmented transaction is already in progress, the subscription is completed at its commit boundary so the materializer never misses the already-written head of that transaction.
