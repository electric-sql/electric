---
'@core/sync-service': patch
---

Fix `DELETE /v1/shape` so a shape can be deleted by its definition. The delete plug discarded every shape parameter other than `table` and `handle`, so any shape with a `where`, `columns`, `params`, `replica` or `log` could only ever be deleted by handle.
