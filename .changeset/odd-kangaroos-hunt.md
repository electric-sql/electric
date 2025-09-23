---
"@core/sync-service": patch
---

Move shape deletion operations into separate process to avoid blocking `ShapeCache` on critical path.
