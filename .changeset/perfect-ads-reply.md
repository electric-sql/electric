---
'@core/electric-telemetry': patch
---

Extend top processes by memory metric to collect processes until the specified mem usage threshold is covered.

`ELECTRIC_TELEMETRY_TOP_PROCESS_COUNT` has been renamed to `ELECTRIC_TELEMETRY_TOP_PROCESS_LIMIT` with a new format: `count:<N>` or `mem_percent:<N>`. The old env var is still accepted as a fallback.
