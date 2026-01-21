---
'@core/sync-service': patch
---

Fix crash in on-demand sync with subqueries when query returns NULL

When using on-demand sync mode with subqueries, if a Postgres query returned NULL for a row, the subset encoder would crash with `ArgumentError: not an iodata term` because `[nil]` is not valid iodata. This fix converts `[nil]` items to the JSON string `"null"` before encoding.
