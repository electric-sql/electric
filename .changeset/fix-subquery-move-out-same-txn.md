---
"@core/sync-service": patch
---

Fix race condition where rows entering a shape via FK update in the same transaction as the parent being deactivated were not correctly removed. The move-out notification could arrive before the materializer subscribed or before the transaction was fully processed, causing the new row to be missed.
