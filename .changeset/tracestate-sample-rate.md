---
"@core/sync-service": patch
---

Honor an upstream head-sampling rate hint received via the W3C `tracestate` header (`electric=rate:<N>`) on shape GET requests:

When the remote parent trace is sampled, the `Plug_shape_get` root span (and the `shape_get.plug.stream_chunk` child spans) are stamped with the `SampleRate` attribute — `N` for responses with status < 500 and `1` for 5xx responses — so tracing backends that understand sampling weights scale aggregates over Electric's spans by the upstream sampling rate instead of under-reporting traffic ~N-fold.

Requests without a remote trace context, with a not-sampled remote parent, or with a missing/invalid rate hint, behave exactly as before.
