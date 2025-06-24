---
"@core/sync-service": patch
---

Fix evaluation of OR operator in where clauses with null values - NULL OR TRUE should be TRUE.
