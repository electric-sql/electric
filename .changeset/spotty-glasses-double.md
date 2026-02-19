---
'@core/sync-service': patch
---

Fix an infinite recursive loop that API request processes may get stuck in when the consumer process is slow to start or dies unexpectedly, without cleaning up after itself.
