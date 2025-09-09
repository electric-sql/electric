---
"@electric-sql/client": patch
---

Add client-side cache buster for expired shapes to prevent 409s

When a shape 409s, the client now stores this information in localStorage and adds a `expired_handle` parameter to future requests for that shape, preventing redundant 409 responses and reducing app loading latency.
