---
'@core/sync-service': patch
'@core/electric-telemetry': patch
---

Add per-shape `electric.shape.response_size.bytes` telemetry distribution, tagged by `root_table`, `is_live`, and `stack_id`. Operators can now attribute response payload volume to individual shapes and tell initial snapshots apart from live long-poll responses.
