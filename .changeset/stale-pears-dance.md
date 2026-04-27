---
'@core/sync-service': patch
---

Optimise OR routing in sync-service filters by indexing OR branches when both sides are indexable, removing the dedicated IN special case, and falling back to `other_shapes` when an OR branch is not optimisable.
