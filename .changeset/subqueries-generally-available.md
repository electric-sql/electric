---
"@core/sync-service": patch
---

Subqueries in shape WHERE clauses are now generally available and always enabled, including incremental move handling for compound `AND`/`OR`/`NOT` expressions. The `allow_subqueries` and `tagged_subqueries` feature flags have been removed — they no longer need to be set via `ELECTRIC_FEATURE_FLAGS`.
