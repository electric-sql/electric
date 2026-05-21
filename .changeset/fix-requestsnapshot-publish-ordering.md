---
'@electric-sql/client': patch
---

Fix `requestSnapshot()` so it resolves only after the injected snapshot batch has been delivered to subscribers, including async and reentrant subscriber paths.
