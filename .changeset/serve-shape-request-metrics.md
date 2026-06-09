---
'@core/electric-telemetry': patch
'@core/sync-service': patch
---

Export a per-request `electric.plug.serve_shape.requests.count` metric tagged by `status`, `known_error` and `live`.
