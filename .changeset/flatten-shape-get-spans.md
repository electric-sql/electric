---
"@core/sync-service": patch
---

Reduce OTel span volume for shape GET requests: the `shape_get.api.load_shape_info` and `shape_get.plug.serve_shape_log` child spans (strictly 1:1 with the root request span) are no longer emitted. Their timing and process-memory information is preserved as attributes on the `Plug_shape_get` root span instead (`load_shape_info.duration_ms`, `load_shape_info.memory.{start,end}.*`, `serve_shape_log.duration_ms`, `serve_shape_log.memory.{start,end}.*`).

Note for operators: since these two names no longer exist as spans, listing them in `ELECTRIC_EXCLUDE_SPANS` (the `Sampler` `:exclude_spans` setting) no longer has any effect — the data is recorded as root-span attributes whenever the request trace is sampled. In embedded usage (elixir-client / Phoenix.Sync) `Api.serve_shape_log/1` previously created a standalone root span; it now records attributes onto the caller's current span if one exists (e.g. the Phoenix request span in OTel-instrumented apps) and emits nothing otherwise.
