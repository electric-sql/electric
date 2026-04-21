---
'@core/sync-service': patch
'@core/electric-telemetry': patch
---

Add per-shape `electric.shape.response_size.bytes` histogram metric tagged with `root_table`, `is_live` and `stack_id`, letting operators attribute response payload volume to individual shapes.
