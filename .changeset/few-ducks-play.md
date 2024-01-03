---
"electric-sql": patch
---

- Fixed SQLite table name parsing for windowed queries and removed deprecated sqlite parser dependency
- Made the ```raw``` API throw for unsafe queries, i.e. anything other than read-only queries, to match ```liveRaw```'s behaviour
- Added an ```unsafeRaw``` API to allow modifying the store directly via the client
