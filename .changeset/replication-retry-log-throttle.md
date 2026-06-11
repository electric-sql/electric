---
"@core/sync-service": patch
---

Throttle the replication event retry logging and stop logging full event payloads.

A failing replication event is retried every 50ms for up to 10 minutes. Previously every attempt logged at error level, flooding the logs (and any error tracker fed from them) with up to ~12,000 messages per incident, each embedding the full inspected event — potentially megabytes of row data. Now the first failure and one progress update every 10 seconds are logged at error level with the event identity (xid/LSN/relation) and a scrubbed failure reason, while the remaining attempts log full detail at debug level.
