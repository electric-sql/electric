---
'@electric-sql/client': patch
---

Document Bun's default 256 concurrent `fetch()` cap in the proxy-auth and deployment skills. Auth/caching proxies running on Bun bottleneck under load unless `BUN_CONFIG_MAX_HTTP_REQUESTS` is raised; Node and Deno are unaffected.
