---
"@core/electric": patch
---

Make sure the database name in the slot is escaped to match PG requirements (a-z, 0-9, \_ and less then 64 chars)
