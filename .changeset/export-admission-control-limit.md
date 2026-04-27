---
'@core/electric-telemetry': patch
'@core/sync-service': patch
---

Export `electric.admission_control.acquire.limit` and `electric.admission_control.reject.limit` metrics so dashboards can plot fill percentage (`acquire.current / acquire.limit`) and over-limit pressure by `kind`.
