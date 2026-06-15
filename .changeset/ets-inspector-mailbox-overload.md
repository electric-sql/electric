---
'@core/sync-service': patch
---

Bound the EtsInspector's mailbox and DB-attempt amplification under cold-start bursts and database degradation. Concurrent lookups of the same relation/oid/feature key now coalesce onto a single in-flight database call instead of each re-running it, terminal results (table-not-found and connection errors) are cached briefly so a burst against a failing key drains the mailbox instead of refilling it, and each relation/column lookup is bounded by an explicit transaction timeout (issue #4370).
