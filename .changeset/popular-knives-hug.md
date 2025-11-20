---
'@core/sync-service': patch
---

Split `ShapeStatus` relation to shape lookup into separate ETS table to avoid congestion on main metadata table.
