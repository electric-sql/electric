---
"@core/sync-service": patch
---

Fix evaluation of OR operator in where clauses with null values - `null OR true` should be `true` and `1 IN (1, NULL)` should be `true`.
