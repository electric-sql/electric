---
"@core/sync-service": patch
---

Implement log chunking, which tries to keep chunks within the specified `LOG_CHUNK_BYTES_THREHSOLD` - see [relevant PR](https://github.com/electric-sql/electric/pull/1606)
