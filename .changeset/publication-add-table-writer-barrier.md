---
"@core/sync-service": patch
---

Wait for in-flight transactions that have written to a table to finish before committing the table's addition to the publication. Previously, such a transaction's writes were neither emitted by the replication stream (they predate the addition) nor included in the initial snapshot (the transaction was still open), so any shape created on the table right after it was added - e.g. after a `TRUNCATE` invalidated the previous shapes - was silently missing those rows for its whole lifetime.
