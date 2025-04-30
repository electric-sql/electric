---
"@core/sync-service": patch
---

Mitigate `EEXIST` error on `rm_rf` due to suspected filesystem race with retries.
