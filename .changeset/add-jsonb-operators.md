---
'@core/sync-service': patch
---

Add JSONB `->` and `->>` operators for field access in where clauses. The `->` operator returns JSONB values while `->>` returns text. Both support key-based access for objects and index-based access for arrays.
