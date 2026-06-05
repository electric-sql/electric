---
"@core/sync-service": patch
---

Add a `pg_txn.fragments_wall_duration_µs` span attribute that tracks the
wall-clock time taken to process all fragments of a single transaction.
