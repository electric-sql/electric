---
'@core/sync-service': patch
---

Add JSONB operators for where clauses:
- `->` and `->>` for field access (returns JSONB and text respectively)
- `@>` and `<@` for containment checks
- `?`, `?|`, and `?&` for key existence checks

Example shape requests:

```
# Filter by nested field value
GET /v1/shapes?table=users&where=(metadata ->> 'status') = 'active'

# Filter by JSON containment
GET /v1/shapes?table=orders&where=data @> '{"type": "premium"}'

# Filter by key existence
GET /v1/shapes?table=events&where=payload ? 'user_id'
```
