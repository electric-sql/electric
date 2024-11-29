---
"@core/sync-service": patch
---

Include caching headers on 304 responses to prevent client from rechecking the previously cached ones over and over again.
