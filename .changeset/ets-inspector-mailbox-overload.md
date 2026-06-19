---
'@core/sync-service': patch
---

Stop the EtsInspector from overloading its mailbox and re-running database lookups during cold-start bursts or while Postgres is degraded (#4370):

- Concurrent lookups of the same relation, oid, or feature now share a single database call instead of each running their own.
- Failed lookups (table-not-found and connection errors) are cached briefly, so a burst against a failing key stops hammering the database.
- Each lookup has an explicit transaction timeout.
- Each lookup is recorded as an `inspector.fetch_db` span so its latency and outcome are visible in telemetry.
