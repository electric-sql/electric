---
"@core/sync-service": patch
---

Don't search for exact log entry with provided offset. Fixes a bug that caused an infinite loop of initial syncs followed by 409s.
