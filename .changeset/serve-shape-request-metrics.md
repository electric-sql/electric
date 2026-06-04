---
'@core/electric-telemetry': patch
'@core/sync-service': patch
---

Export a per-request `electric.plug.serve_shape.requests.count` metric tagged
by `status`, `known_error` and `live`.

Existing `serve_shape` metrics drop live (long-poll) requests and are not
dimensioned by response status, so they can't answer "what's my request mix /
error rate right now". This counter intentionally counts every request
(including live) and is unsampled, making it a reliable request-health signal
that doesn't depend on trace sampling. Admission-control rejections show up
here as `status=503, known_error=true` (the conn is halted but still flows
through `emit_shape_telemetry/1`), so overload is visible alongside normal
traffic. The `known_error` tag mirrors the `electric-internal-known-error`
response header, so it matches the classification downstream consumers key on.
