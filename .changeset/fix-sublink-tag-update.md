---
"@core/sync-service": patch
---

Fixed a bug where rows with subquery-based WHERE clauses could retain stale move tags when the sublink column value changed during a pending move-in, causing the row to not be properly removed on subsequent move-outs.
