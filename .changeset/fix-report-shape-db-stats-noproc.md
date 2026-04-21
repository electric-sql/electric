---
'@core/sync-service': patch
---

Guard `report_shape_db_stats` telemetry poller against `:noproc` exits when the shape status GenServer terminates during stack restarts, mirroring the existing handling in `report_retained_wal_size`.
