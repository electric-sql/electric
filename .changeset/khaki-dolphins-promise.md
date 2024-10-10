---
"@electric-sql/client": patch
"@core/sync-service": patch
---

Fix inconsistencies in http proxies for caching live long-polling requests.

The server now returns a cursor for the client to use in requests to cache-bust any stale caches.
