---
"@core/sync-service": patch
---

Support shutting down database connections automatically when the replication stream is idle. This allows for scaling down the database compute on supported providers.
