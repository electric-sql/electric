---
"@core/electric-telemetry": patch
"@core/sync-service": patch
---

Tail-drop the OpenTelemetry spans of empty/up-to-date shape-GET responses at export time to cut trace volume. Disabled by default; set `ELECTRIC_DROP_EMPTY_RESPONSE_SPANS=true` to enable the drop. Error (5xx) and SSE responses are never dropped.
