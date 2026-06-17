---
"@core/sync-service": patch
---

Stop the ShapeLogCollector from crashing when table introspection fails on the hot replication path.

Previously the replication pipeline only handled `{:error, :connection_not_available}` from the inspector; every other legal inspector return crashed the ShapeLogCollector and took the whole shapes supervision tree down with it, putting the replication client into a 10-minute noproc retry loop:

- `:table_not_found` (table dropped or renamed between the WAL record and introspection) crashed `Partitions.handle_relation/2` and the pk-column lookup with a `CaseClauseError`. Relation messages for dropped tables are now ignored and changes for dropped tables are keyed on the full record, the same fallback used for tables without a primary key.
- In-band database errors (e.g. out-of-memory, `statement_timeout` cancelling the catalog query) crashed `Partitions.handle_relation/2` with a `CaseClauseError` and made `Partitions.add_shape/3` raise. They are now propagated as `{:error, reason}`; the collector logs a warning and pauses replication via the existing retry path until introspection succeeds.
- Connection-class errors returned in-band by Postgrex (e.g. `"ssl recv: closed"`) are now classified as `:connection_not_available` instead of leaking through as strings.
- Shape restore no longer crashes with a `MatchError` when the connection pool isn't ready yet; it retries the introspection in place and only gives up (with a descriptive error) after ~10 seconds.
