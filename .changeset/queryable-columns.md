---
"@core/sync-service": patch
---

Add `queryable_columns` as a server-side shape allow-list for columns that may be queried by subset snapshots or synced. This lets proxies decouple the `columns` sync projection from the subset-query security boundary while preventing subset filters and ordering, and projected columns, from referencing non-queryable columns.
