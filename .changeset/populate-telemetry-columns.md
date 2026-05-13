---
'@core/sync-service': patch
---

Populate previously-empty `electric.subqueries.subset_result.{bytes,rows,duration_µs}` telemetry span attributes on subset materialisation spans so the corresponding Honeycomb columns become queryable.
