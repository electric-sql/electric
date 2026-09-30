---
'@electric-sql/client': patch
---

Prevent subset snapshots from advancing established ShapeStream offsets and skipping live changes outside the requested subset. Concurrent cold-start snapshots now resume from their earliest insertion point.
