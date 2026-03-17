---
'@core/sync-service': patch
---

Fix stale PID handling in restore_shape_and_dependencies: check if consumer process is alive before reusing it from ConsumerRegistry
