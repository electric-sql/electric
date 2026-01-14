---
'@core/sync-service': patch
---

Add JSONB operators for where clauses:
- `->` and `->>` for field access (returns JSONB and text respectively)
- `@>` and `<@` for containment checks (e.g., `data @> '{"type": "premium"}'`)

Both field access operators support key-based access for objects and index-based access for arrays.
