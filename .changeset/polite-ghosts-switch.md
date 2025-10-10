---
'@core/sync-service': patch
---

Parse more DB errors as retryable (`ssl connect: closed` and `connection_refused` with PG code 08006).
