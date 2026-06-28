---
"@core/electric-telemetry": patch
---

Fix unbounded `process_type` cardinality on request-handling processes. `parse_binary_label/1` only stripped the request id from process labels when it was exactly 20 bytes (the length `Plug.RequestId` self-generates). A proxy- or load-balancer-supplied `x-request-id` (UUID, Envoy/nginx trace id, etc.) has a different length, so the raw per-request id leaked into `process_type`, adding a permanent new series to telemetry events like `vm.monitor.long_gc` and `vm.monitor.long_schedule` for every distinct id. The label is now parsed by splitting on the `" - "` delimiter regardless of request-id length, collapsing all requests to a route back to a single `process_type` (e.g. `GET /v1/shape`).
