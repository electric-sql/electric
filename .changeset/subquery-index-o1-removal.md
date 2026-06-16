---
"@core/sync-service": patch
---

Restore O(1) removal of subquery shapes from the where-clause filter. The v1.6 subquery index removed shapes with full-table ETS scans, so removing a shape cost O(total shapes × values) and blocked replication processing — causing WAL lag when many seeded subquery shapes were present. The index now uses an `:ordered_set` with prefix-bounded deletes, making shape removal independent of the total number of shapes, the number of shapes on a node, and the number of shapes sharing a value.
