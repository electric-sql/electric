---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
---

Fix child wake delivery so multiple deferred wakes for the same entity stream are preserved and runFinished wake evaluation recovers from a stale server-side registration cache.
