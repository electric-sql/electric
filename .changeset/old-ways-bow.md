---
"electric-sql": patch
---

Fixed using `.sync()` calls before the replication is established. Now we defer trying to subscribe until the replication is succesfully established if we're already in the process of connecting and starting.
