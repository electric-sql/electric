---
"@core/electric-telemetry": patch
---

Reduce SystemMonitor heap growth by avoiding full process dictionary, memory, and binary metadata when classifying monitor events, and periodically garbage collect the monitor process.
