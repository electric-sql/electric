---
'@core/sync-service': patch
---

Return 503 instead of 400 in case generated column replication is not enabled for PG >=18.
