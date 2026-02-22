---
'@core/sync-service': patch
---

Implement a write mode in shape consumer that can write transaction fragments directly to the shape log, without buffering the complete transaction in memory.
