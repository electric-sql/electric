---
'@core/sync-service': patch
---

Promote an already-running standalone shape consumer to whole-transaction writes when a subquery materializer subscribes to it. If a fragmented transaction is already in progress, defer the promotion until its commit boundary.
