---
'@electric-sql/client': patch
---

Fix stale cached responses with expired shape handles

When a CDN/proxy is misconfigured and serves a stale cached response with an expired shape handle, the client would get into a broken state where the handle was rejected but the offset was still advanced. This fix detects stale responses and triggers a retry with a cache buster parameter to bypass the misconfigured CDN cache.
