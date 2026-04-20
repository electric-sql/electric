---
"@core/sync-service": patch
---

Fix replication connection drops caused by PostgreSQL's wal_sender_timeout during backpressure. The replication client now sends periodic keepalive messages while event processing is paused, preventing the connection from being killed during slow downstream processing.
