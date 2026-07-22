---
"@core/sync-service": patch
"@core/electric-telemetry": patch
---

Prevent a dead or stalled shape consumer from pinning the replication slot's `confirmed_flush_lsn` indefinitely, which caused unbounded WAL retention. The collector now monitors the writer behind every pending flush entry — a crashed writer unpins its entry immediately, and a shape making no flush progress past a grace period is challenged and invalidated if it doesn't respond.

