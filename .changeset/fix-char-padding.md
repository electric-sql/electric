---
"@core/sync-service": patch
---

Fixed char(n) column values being trimmed of trailing spaces in snapshot and subset queries, causing inconsistency with values from PG replication.
