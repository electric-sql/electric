---
'@core/sync-service': patch
---

Move exclusive connection lock inside replication connection to reduce number of `wal_sender` processes used from 2 to 1 per instance.
