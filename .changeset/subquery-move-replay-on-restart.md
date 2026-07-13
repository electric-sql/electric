---
'@core/sync-service': patch
---

Fix optimized streaming subquery shapes losing dependency move-ins/move-outs
across a graceful server restart. On restart the dependency materializer now
replays the moves each outer consumer missed (deduplicated by a persisted
per-dependency source-LSN position), so the outer shape catches up instead of
diverging from Postgres. Replay uses the authoritative persisted shape-log
offset for control messages and spliced move-in rows, including nested
subqueries whose generated JSON records do not contain source LSNs.
