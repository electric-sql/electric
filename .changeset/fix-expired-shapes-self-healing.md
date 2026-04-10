---
'@electric-sql/client': patch
---

Fix permanently stuck expired shape handles in localStorage by adding self-healing retry. When stale cache retries are exhausted (3 attempts with cache busters), the client now clears the expired entry from localStorage and retries once without the `expired_handle` parameter. Since the server never reuses handles (documented as SPEC.md S0), the fresh response will have a new handle and bypass stale detection. This prevents shapes from being permanently unloadable when a proxy strips cache-buster query parameters.
