---
"@core/sync-service": patch
---

Introduce `AsyncDeleter` service for fast batch deletes, done by renaming deprecated files into a temporary directory and batch deleting them in the background.
