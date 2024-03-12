Size of the on-disk cache of transactions that are retained as WAL records inside Postgres. Measured in bytes unless one of the following suffixes is used: `k` for KB; `K` for KiB; `m` for MB; `M` for MiB; `g` for GB; `G` for GiB.

This cache is used to catch up connecting clients to the current state in Postgres. If a client's position in the replication stream predates the oldest transaction in the cache, the client will have to discard its local database and start a new replication connection to repopulate the data for all of its subscribed shapes from scratch.

_In the future Electric may store change diffs or employ techniques for compacting the retained WAL records with the goal of extending the time frame during which a client may catch up to the latest server state without discarding its local database._
