---
'@core/sync-service': patch
---

Compute correct tags for NULL column values in subqueries

When using on-demand sync with subqueries (e.g., `parent_id IN (SELECT ...)`), rows with NULL values in the subquery column now produce correct tags. Previously, `md5('...' || col::text)` would return NULL when `col` is NULL. This fix coalesces NULL to a `'__NULL__'` sentinel before hashing, ensuring NULL and empty string produce distinct tags.
