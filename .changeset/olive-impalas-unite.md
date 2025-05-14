---
"@core/sync-service": patch
---

Drop and recreate the replication slot when the publication goes missing. This will also invalidate existing shapes to ensure consistency. Fixes #609.
