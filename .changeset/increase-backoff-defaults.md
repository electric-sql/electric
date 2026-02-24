---
'@electric-sql/client': patch
---

Increase default backoff parameters to reduce retry storms when a proxy fails. `initialDelay` changes from 100ms to 200ms and `multiplier` from 1.3 to 1.8, reaching the 60s max delay in ~10 retries instead of ~25.
