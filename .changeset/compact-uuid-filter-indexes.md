---
'@core/sync-service': patch
---

Store parsed UUID values as 16-byte binaries instead of canonical text inside the sync-service filter evaluator. This reduces memory use in where-clause filter indexes, especially equality and subquery index keys, while converting UUIDs back to canonical strings at API and SQL output boundaries. The shape metadata version is bumped so persisted shape comparable terms created with the old UUID string representation are ignored and rebuilt.
