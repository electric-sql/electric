---
'@core/sync-service': patch
---

Add write_concurrency to ShapeStatus ETS tables to improve performance under concurrent workloads. Enables `write_concurrency: true` on both LastUsedTable and MetaTable to reduce lock contention during concurrent shape operations, addressing slow deletes with large numbers of shapes.
