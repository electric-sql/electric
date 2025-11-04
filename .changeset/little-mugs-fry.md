---
'@core/sync-service': patch
---

Ensure async deletion requests don't clog up as removal is taking place by moving removal to asynchronous task.
