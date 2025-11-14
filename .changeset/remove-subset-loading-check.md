---
'@electric-sql/client': patch
---

Fix error when using LiveQuery joins with collections in progressive syncMode.

Removed the check that prevented `requestSnapshot` from being called in full mode. It's valid to load subsets while loading the full log, which is necessary for LiveQuery joins with collections using progressive syncMode.

Previously, this scenario would throw: "Snapshot requests are not supported in full mode, as the consumer is guaranteed to observe all data"
