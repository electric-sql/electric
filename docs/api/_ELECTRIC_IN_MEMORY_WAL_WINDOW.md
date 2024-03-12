Size of the in-memory cache of transactions coming from Postgres over the logical replication stream. Measured in bytes unless one of the following suffixes is used: `k` for KB; `K` for KiB; `m` for MB; `M` for MiB; `g` for GB; `G` for GiB.

This cache is used to quickly catch up connecting clients to the current state in Postgres. If a client's position in the replication stream predates the oldest transaction in the cache, the client can still be caught up from the on-disk WAL cache which is configured separately with `ELECTRIC_RESUMABLE_WAL_WINDOW`.
