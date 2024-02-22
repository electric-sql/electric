---
"electric-sql": patch
---

Fix race condition in performSnapshot. Changes can only be sent to remote when the outbound replication status is active
