---
"@core/sync-service": patch
---

Honor an upstream head-sampling rate hint received via the W3C `tracestate` header (`electric=rate:<N>`) on shape GET requests:

- When the remote parent trace is sampled, the `Plug_shape_get` root span (and the `shape_get.plug.stream_chunk` child spans) are stamped with Honeycomb's `SampleRate` attribute — `N` for responses with status < 500 and `1` for 5xx responses — so Honeycomb weights aggregates over Electric's spans by the upstream sampling rate instead of under-reporting traffic ~N-fold.

- When the remote parent trace is NOT sampled and the request ends in a 5xx response, a single root request span is now synthesized and exported with `SampleRate=1` in the same trace as the upstream's spans (same trace_id, parented on the remote span), so server-side error telemetry is no longer lost to upstream head-sampling. Unsampled successful requests still export nothing.

Requests without a remote trace context, or with a missing/invalid rate hint, behave exactly as before.
