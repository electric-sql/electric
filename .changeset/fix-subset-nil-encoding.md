---
'@core/sync-service': patch
---

Fix crash when subquery column is NULL

Fixes a crash (`ArgumentError: not an iodata term`) when using on-demand sync with subqueries (e.g., `task_id IN (SELECT ...)`) and rows have NULL values in the referenced column.

**Root cause:** In `make_tags`, the SQL expression `md5('...' || col::text)` returns NULL when `col` is NULL (because `|| NULL` = NULL in PostgreSQL). This NULL propagates through all string concatenation in the row's JSON construction, causing the encoder to receive `nil` instead of valid iodata.

**Fix:** Namespace column values with a `v:` prefix, and represent NULL as `NULL` (no prefix). This ensures:
- NULL values don't propagate through concatenation
- NULL and the string literal `'NULL'` produce distinct hashes
- No restrictions on what values users can have in their columns
