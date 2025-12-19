---
'@electric-sql/client': patch
---

Fix infinite 409 loop when proxy returns stale cached response with expired shape handle.

**Root cause:** When a 409 response arrives, the client marks the old handle as expired and fetches with a new handle. If a proxy ignores the `expired_handle` cache buster parameter and returns a stale cached response containing the old handle, the client would accept it and enter an infinite 409 loop.

**The fix:**
- In `#onInitialResponse`: Don't accept a shape handle from the response if it matches the expired handle in the expired shapes cache
- In `getNextChunkUrl` (prefetch): Don't prefetch the next chunk if the response handle equals the `expired_handle` from the request URL
- Added console warnings when this situation is detected to help developers debug proxy misconfigurations

This provides defense-in-depth against misconfigured proxies that don't include all query parameters in their cache keys.
