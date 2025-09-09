---
"@core/sync-service": patch
---

Do not crash `ReplicationClient` if `ShapeLogCollector` is missing - wait for it to get back up.
