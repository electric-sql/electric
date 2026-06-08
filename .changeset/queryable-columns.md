---
"@core/sync-service": patch
---

Add `queryable_columns` as a server-side shape allow-list for columns that may be queried or synced. This lets proxies decouple the `columns` sync projection from the security boundary while preventing `where`, subset filters and ordering, and projected columns from referencing non-queryable columns.
