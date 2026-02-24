---
'@core/sync-service': patch
---

Prevent chunk boundary offsets from being exposed to clients mid-transaction, which could cause readers to observe incomplete transaction data.
