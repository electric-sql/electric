---
"@core/sync-service": patch
---

Add a new configuration option ELECTRIC_REPLICATION_IDLE_TIMEOUT to allows Electric to close database connections automatically when the replication stream is idle. This allows for scaling down the database compute on supported providers.
