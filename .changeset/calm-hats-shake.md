---
"@core/sync-service": patch
---

Fix issue that would return a 500 for one of the requests when there are two concurrent requests for the same shape that is not already in cache
