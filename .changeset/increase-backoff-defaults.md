---
'@electric-sql/client': patch
---

Increase default retry backoff parameters to reduce retry storms when a proxy fails, aligning with industry-standard values (gRPC, AWS). `initialDelay` 100ms → 1s, `multiplier` 1.3 → 2, `maxDelay` 60s → 32s. Reaches cap in 5 retries instead of ~25.
