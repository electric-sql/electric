---
'@core/sync-service': patch
---

Drop shapes that involve subqueries on server restart instead of restoring them.
Restoring a subquery shape's on-disk view consistently alongside its dependency
materializer across a restart proved too fragile, so the sync service now removes
every shape involved in a subquery (the outer shape and its dependency
materializers) on startup and lets clients re-request them from scratch.
