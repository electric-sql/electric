---
'@core/sync-service': patch
---

Avoid sending duplicate publication-configuration requests while one is already in progress. Under a burst of shape arrivals, the publication manager no longer issues a separate request for every shape added or removed, preventing the configurator's message queue from growing without bound (issue #4396).
