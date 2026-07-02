---
"@core/sync-service": patch
---

Tail-drop the OpenTelemetry spans of empty/up-to-date shape-GET responses at export time to cut trace volume. Enabled by default; set `ELECTRIC_DROP_EMPTY_RESPONSE_SPANS=false` to export those spans normally. Error (5xx) and SSE responses are never dropped.
