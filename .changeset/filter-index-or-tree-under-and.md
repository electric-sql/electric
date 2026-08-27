---
"@core/sync-service": patch
---

Keep an indexable `IN (...)` / `OR` condition in the shape filter index when it is `AND`ed with a condition that is not itself indexable (e.g. `category_id IN ('a', 'b') AND deleted_at IS NULL`). Previously the whole conjunction fell back to a linear scan of every shape on the node for every change, so write throughput degraded with the number of such shapes. The `AND` is now distributed over the `OR` branches, so each branch is indexed and the non-indexable condition is only evaluated for the shapes the index selects. `IN (...) AND IN (...)` is indexed the same way, bounded by a cap on the number of resulting index leaves.
