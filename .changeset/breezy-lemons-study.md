---
'@core/sync-service': patch
---

Fix a failure scenario where a shape is tracked by FlushTracker even though its consumer process dies. This resulted in FlushTracker stalling and not advancing forward, leading to unbounded WAL growth in Postgres.
