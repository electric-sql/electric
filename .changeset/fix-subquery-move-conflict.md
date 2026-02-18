---
'@core/sync-service': patch
---

Fix subquery materializer bug where a value toggling across the 0↔1 boundary multiple times in a single batch could lose data by emitting conflicting move_in/move_out events for the same value.
