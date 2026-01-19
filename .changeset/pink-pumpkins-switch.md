---
'@core/electric-telemetry': patch
---

Bring back previously removed median and mode fields to Summary metrics in CallHomeReporter's payload (applies to used_memory, run_queue_total, run_queue_cpu, run_queue_io, and wal_size). Their absence caused the remote collector server to reject incoming reports.
