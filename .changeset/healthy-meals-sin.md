---
'@core/sync-service': patch
---

Fix a memory leak where for terminated shapes PureFileStorage would still maintain an entry in its ETS table.
