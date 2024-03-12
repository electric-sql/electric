Maximum size that the sync service is allowed to use for keeping around old WAL records in Postgres. Measured in bytes unless one of the following suffixes is used: `k` for KB; `K` for KiB; `m` for MB; `M` for MiB; `g` for GB; `G` for GiB.

Normally, Postgres discards WAL records as soon as they are acknowledged by the replica. However, for the sync service to be able to restore its caches after a restart, it needs to hold on to old WAL records since those may contain transactions that affect electrified tables.

Setting this to a low value may lead to clients having to discard their local copy of the server state and restart their replication stream from scratch.

_In the future Electric may store change diffs or employ techniques for compacting the retained WAL records with the goal of extending the time frame during which a client may catch up to the latest server state without discarding its local state._
