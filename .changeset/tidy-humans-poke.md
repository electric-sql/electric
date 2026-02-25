---
'@core/sync-service': patch
---

Add `electric-has-data` response header to distinguish data-bearing responses from control-only responses (e.g. long-poll timeouts, `offset=now` requests).
