---
"@core/sync-service": minor
---

feat: added a new storage engine, replacing the old one by default

New engine brings about a very nice speedup for reads, writes, and scalability. If you want the old one, you can use `ELECTRIC_STORAGE=file` environment variable.
