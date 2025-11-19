---
'@core/sync-service': patch
---

Replace max LSN recovery from on-disk shapes with direct read from replication slot flushed LSN.
