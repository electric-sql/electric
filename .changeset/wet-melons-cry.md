---
"@electric-sql/experimental": patch
"@core/sync-service": patch
---

Encode LSN as string in JSON responses for correct handling of large values (>53 bits) in Javascript.
