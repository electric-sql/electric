---
"electric-sql": patch
---

Fixed garbage collection on shape unsubscribe (also called on subscription errors), which caused the DELETEs performed by GC get noted in operations log and sent to the server, causing data loss
