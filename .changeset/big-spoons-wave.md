---
"@core/sync-service": patch
---

Fix constant hibernate->wakeup->hibernate loop for shape consumers by only sending a flushed message if there was data in the write buffer
