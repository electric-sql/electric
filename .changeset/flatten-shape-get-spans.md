---
"@core/sync-service": patch
---

Reduce OTel span volume for shape GET requests: the `shape_get.api.load_shape_info` and `shape_get.plug.serve_shape_log` child spans (strictly 1:1 with the root request span) are no longer emitted. Their timing and process-memory information is preserved as attributes on the `Plug_shape_get` root span instead (`load_shape_info.duration_ms`, `load_shape_info.memory.{start,end}.*`, `serve_shape_log.duration_ms`, `serve_shape_log.memory.{start,end}.*`).
