---
"@core/sync-service": patch
---

Electric now runs in Secure mode by default, requiring an `ELECTRIC_SECRET` to be set.

BREAKING CHANGE: Electric now needs to be started with an `ELECTRIC_SECRET` environment variable unless `ELECTRIC_INSECURE=true` is set.
