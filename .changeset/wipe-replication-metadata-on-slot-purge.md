---
'@core/sync-service': patch
---

Reset replication metadata caches when shapes are purged on a new or temporary
replication slot. Previously, when Electric purged all shapes after the
replication slot was (re)created — e.g. a temporary slot recreated on restart
with `CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN=true` — the persisted relation
tracking (`tracked_relations`) and the inspector cache (`ets_inspector_state`)
survived and were read back on startup, even though WAL continuity had been
lost. These caches are now reset as part of the same purge, so no stale
pre-restart metadata is reused.
