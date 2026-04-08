---
"@core/sync-service": patch
---

Fix admission control bypass where shapes were created before admission control checks. Shape creation now happens after admission control, preventing resource exhaustion under load.
