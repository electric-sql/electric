---
"@core/sync-service": patch
---

Fix keepalives acknowledging WAL past small transactions whose storage flush hasn't been confirmed yet. A crash in that window could permanently lose the transaction for all affected shapes, since the replication slot had already advanced past it.
