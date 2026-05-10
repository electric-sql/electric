---
'@core/sync-service': patch
---

Add `txids` to `move-in`/`move-out` control messages, mirroring the per-row `headers.txids` already emitted on insert/update/delete log entries. The list contains the upstream Postgres xid(s) whose commit caused the dependency boundary to flip, threaded from the consumer through the materializer, MoveQueue, and ActiveMove into the broadcast headers.
