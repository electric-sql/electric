---
"@core/sync-service": patch
---

Fix subquery dependency deduplication for same-table subqueries that project different columns, preventing plain snapshots from silently dropping one arm of an `OR` filter.
