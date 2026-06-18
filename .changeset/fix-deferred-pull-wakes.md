---
'@electric-ax/agents-runtime': patch
---

Fix pull-wake delivery so multiple deferred wakes for the same entity stream are preserved and delivered instead of being overwritten while an earlier wake is still active.
