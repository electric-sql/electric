---
"@core/sync-service": patch
---

Fix memory spike during Materializer startup by using lazy stream operations instead of eager Enum functions in `decode_json_stream/1`.
