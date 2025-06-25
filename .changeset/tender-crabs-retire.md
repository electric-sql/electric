---
"@core/sync-service": patch
---

Fix race between loading shape and listening for updates to it that caused requests to hang for longer than necessary.
