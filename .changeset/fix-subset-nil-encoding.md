---
'@core/sync-service': patch
---

Fix crash when subquery column is NULL

Fixes a crash (`ArgumentError: not an iodata term`) when using on-demand sync with subqueries (e.g., `task_id IN (SELECT ...)`) and rows have NULL values in the referenced column.

**Root cause:** In `make_tags`, the SQL expression `md5('...' || col::text)` returns NULL when `col` is NULL (because `|| NULL` = NULL in PostgreSQL). This NULL propagates through all string concatenation in the row's JSON construction, causing the encoder to receive `nil` instead of valid iodata.

**Fix:** Coalesce NULL column values to `'__NULL__'` sentinel before hashing. Using a sentinel (not empty string) ensures NULL and `''` produce distinct hashes.
