---
"@core/sync-service": patch
---

Fix crash when LsnTracker ETS table is empty during long-poll timeout. Return nil instead of crashing, fall back to shape offset, and align request read-only flag with runtime status. Also fix stale flushed_wal (always 0) when populating LsnTracker during replication slot creation.
