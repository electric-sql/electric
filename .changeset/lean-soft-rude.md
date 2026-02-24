---
"@core/sync-service": patch
---

Handle missing memstat SQLite extension gracefully instead of crashing on startup. When the extension is unavailable, memory statistics are simply omitted from the periodic stats collection.
