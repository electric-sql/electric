---
'@core/sync-service': patch
---

Fix race condition where HTTP readers crash with ArgumentError on deleted ETS buffer table during stack restarts
