---
"@core/sync-service": patch
---

Add a new configuration option ELECTRIC_REPLICATION_IDLE_TIMEOUT that allows Electric to close database connections automatically when the replication stream is idle. This enables the database server to scale-to-zero on supported providers.
