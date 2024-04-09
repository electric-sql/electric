---
"@core/electric": patch
---

Introduce the concept of "WAL window" that Electric can keep around to enable it to recover already-seen transactions after a restart.

Where previously Electric was acknowledging transactions as soon as it was
receiving them from Postgres, now it will manually advance its replication's
slot starting position when needed to keep the overall disk usage within the
configurable limit. This allows Electric to replay some transactions it
previously consumed from the logical replication stream after a restart and
repopulate its in-memory cache of transactions that it uses to resume clients'
replication streams.
