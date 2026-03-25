---
'@electric-sql/client': patch
---

Add exponential backoff to onError-driven retries to prevent tight loops on persistent 4xx errors (e.g. expired auth tokens returning 403). The backoff uses jitter with a 100ms base and 30s cap, and is abort-aware so stream teardown remains responsive.
