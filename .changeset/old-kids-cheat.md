---
"@core/sync-service": patch
---

Fix handling of some connections errors. Treat "wal_level != logical" as a fatal error after which there's no point in retrying the connection.
