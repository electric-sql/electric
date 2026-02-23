---
'@electric-sql/client': patch
---

Fix infinite retry loop when server reuses the same shape handle after a 409. Use the HTTP `age` header to distinguish fresh origin responses from stale CDN hits, preventing unnecessary cache-busted retries.
