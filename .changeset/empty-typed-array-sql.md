---
"@core/sync-service": patch
---

Keep the element type when writing a constant-folded empty array back to SQL (`ARRAY[]::text[]` instead of `ARRAY[]`). A shape whose where clause has a subquery and compares a column to an empty typed array, such as `tag = ANY(ARRAY[]::text[])`, no longer fails its snapshot with "cannot determine type of empty array".
