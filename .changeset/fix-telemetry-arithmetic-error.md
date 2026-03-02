---
"@core/sync-service": patch
---

Fixed ArithmeticError in `ServeShapePlug.end_telemetry_span/2` when `parse_body` halts before the telemetry span is started. Moved `parse_body` plug after `start_telemetry_span` in the pipeline.
