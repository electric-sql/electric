---
'@core/sync-service': patch
---

Reduce memory buildup when calculating least recently used shapes by using `:ets.foldl`.
