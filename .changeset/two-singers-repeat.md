---
'@core/sync-service': patch
---

Fix the issue where transactions that had exactly max_batch_size changes weren't written to the shape log.
