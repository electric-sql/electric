---
'@core/sync-service': patch
---

Fix a bug in LockBreakerConnection that was preventing it from terminating stuck backends holding the advisory lock.
