---
"@core/sync-service": patch
---

Add a `total_processing_time` span attribute that tracks the wall-clock time
taken to process all fragments of a single transaction.
