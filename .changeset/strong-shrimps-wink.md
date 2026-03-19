---
'@core/elixir-client': patch
---

Fix infinite loop when CDN serves stale cached responses to a client with a
valid local handle. The client now always retries with a cache-buster parameter
to bypass stale CDN caches.

