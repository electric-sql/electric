---
"@core/sync-service": patch
---

Fix an authentication bypass on `/v1/shape` in secure mode. Authentication now gates on the route resolved by the router rather than on the raw request path, so requests whose target normalizes to `/v1/shape` (e.g. a trailing slash, a doubled slash, or a percent-encoded character) can no longer skip the secret check. CORS headers for shape routes are matched the same way.
