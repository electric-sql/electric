---
'@core/sync-service': patch
---

Reclassify `branch_does_not_exist` error as retryable. PlanetScale returns this
error transiently during cluster maintenance, and classifying it as non-retryable
caused sources to be permanently shut down requiring manual restart.
