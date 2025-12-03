---
'@core/electric-telemetry': patch
'@core/sync-service': patch
---

Fix the name of the metrics that reports replication slot's confirmed flush lag and add two new metrics: retained WAL size (the diff between PG's current LSN and the slot's restart_lsn) and the current PG LSN itself which can be used to plot the write rate happening in the database at any given time.
