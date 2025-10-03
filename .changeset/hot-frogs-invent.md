---
"@core/sync-service": patch
---

Reduce memory footprint of shape consumer processes by avoiding repeating the same path prefix multiple times and calculating shape-specific storage fields on the fly instead.
