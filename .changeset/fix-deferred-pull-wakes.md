---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
---

Fix child wake delivery so multiple deferred wakes for the same entity stream are preserved.

Refactor the server wake registry to use TanStack DB collections and optimistic actions over `wake_registrations`, removing the manual ShapeStream-backed registration cache and stale-cache reload fallback.
