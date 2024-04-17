---
"@core/electric": patch
---

Persist client reconnection info to the database. This allows the sync service to restore its caches after a restart to be able to resume client replication streams and avoid resetting their local databases.
