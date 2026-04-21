---
'@core/sync-service': patch
---

Populate previously-empty telemetry span attributes for shape requests: `num_bytes` on the root shape-get span and `electric.subqueries.subset_result.{bytes,rows,duration_µs}` on subset materialisation spans. This makes the corresponding Honeycomb columns queryable.
