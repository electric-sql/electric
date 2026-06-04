---
"@core/sync-service": patch
---

Add a `pg_txn.fragments_wall_duration_µs` attribute to the
`pg_txn.replication_client.transaction_received` span (set on the commit
fragment). It records the wall-clock time a transaction's fragments spanned as
received from Postgres (begin → commit). Because the replication stream is
consumed on demand (e.g. paused while database connections are scaled down),
this includes idle gaps between fragments and can be far larger than the
per-fragment processing time — making it possible to spot transactions whose
fragments straddle a shape consumer's suspend threshold.
