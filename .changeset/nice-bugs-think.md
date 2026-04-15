---
'@core/sync-service': patch
---

Add sync-service telemetry for indexed vs unindexed shape counts, backed by maintained in-memory counters so periodic metrics stay O(1) even on very large stacks.
