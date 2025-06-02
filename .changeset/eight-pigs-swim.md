---
"@core/sync-service": patch
---

Open a replication connection to acquire the exclusive connection lock, fixing the lock semantics for cases where Electric runs with a pooled connection string.
