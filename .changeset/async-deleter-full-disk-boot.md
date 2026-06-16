---
"@core/sync-service": patch
---

Fix `AsyncDeleter` crashing the stack on boot when the storage volume is full. It now boots resiliently, logs the real error (e.g. `ENOSPC`) instead of a misleading `ENOENT`, and self-heals — creating the trash directory and recapturing pending deletions once disk space is available again.
