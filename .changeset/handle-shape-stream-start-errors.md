---
"@electric-sql/client": patch
---

Prevent subscription startup failures from also surfacing as unhandled promise
rejections after they are delivered to the subscriber error callback.
