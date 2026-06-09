---
"@core/sync-service": patch
---

Add `queryable_columns` as a means to restrict access to sensitive columns, a server-side shape allow-list for columns that may be synced or queried by subset snapshots.
