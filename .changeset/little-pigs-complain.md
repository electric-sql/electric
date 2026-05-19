---
'@core/sync-service': patch
---

Remove the single-function PartialMode module by moving its query_subset() function into SnapshotQuery, so that its implementation could sit close to SnapshotQuery.execute_for_shape().
