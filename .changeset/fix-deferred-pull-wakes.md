---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
---

Fix child wake delivery so same-stream wake trigger notifications are queued while an active claim is already running, ensuring the runner checks for all pending wake rows again after the active work drains.

Refactor the server wake registry to use TanStack DB collections and optimistic actions over `wake_registrations`, removing the manual ShapeStream-backed registration cache and stale-cache reload fallback.
