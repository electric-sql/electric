---
'@core/sync-service': patch
---

Hibernate some processes after init() that tend to accumulate garbage during initialisation. Because the process heap doesn't keep growing at the same high rate post-initialisation, GC never runs for it and the garbage never gets collected.
