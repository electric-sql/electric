---
'@core/sync-service': patch
---

Add process and binary memory-footprint attributes to the spans under `Plug_shape_get` (`shape_get.api.load_shape_info`, `shape_get.plug.serve_subset_response`, `shape_get.plug.serve_shape_log`, `shape_get.plug.stream_chunk`, and the root span itself). Long-lived shape requests now expose `memory.start.{process,binary}_bytes` / `memory.end.{process,binary}_bytes` (and per-chunk `memory.{process,binary}_bytes` on stream-chunk spans), making memory growth across a request queryable in the span viewer.
