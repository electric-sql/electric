---
'@core/sync-service': patch
---

Fix retry-after header not being exposed via CORS

The server was sending the retry-after header to clients during overload scenarios (503 responses), but the header was not included in the access-control-expose-headers CORS header. This caused browsers to block access to the retry-after value, preventing clients from honoring the server's backoff directive.

As a result, clients would ignore the server's retry-after header and use only exponential backoff with jitter, which could result in very short retry delays (as low as 0-100ms on early retries), leading to intense retry loops during server overload.
