---
'@core/sync-service': patch
---

Automatically upgrade existing publications to set `publish_generated_columns = stored` when running on PostgreSQL 18+. This fixes the case where a publication was created by an older Electric version before PG18 generated columns support was added.
