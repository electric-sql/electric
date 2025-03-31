---
"@core/sync-service": patch
---

Never cache `>= 400` response codes, except `409` as effective redirects, and anything other than `GET` and `OPTIONS`.
