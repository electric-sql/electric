---
'@core/sync-service': patch
---

Add `ELECTRIC_EXCLUDE_SPANS` env var to exclude arbitrary OTel spans by name, helping manage telemetry quota usage.
