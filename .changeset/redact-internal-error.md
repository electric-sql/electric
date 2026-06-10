---
"@core/sync-service": patch
---

Redact internal exception details from 500 responses. Uncaught errors in the shape-serving plug previously returned the full Elixir stacktrace (internal module paths, library versions, partial query text) in the response body. Clients now receive a generic `"Internal server error"` message; the full detail is still captured server-side via OpenTelemetry.
