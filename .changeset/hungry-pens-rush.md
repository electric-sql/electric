---
'@core/sync-service': patch
---

Fix ETS read/write race condition in PureFileStorage

Fixed a race condition where readers could miss data when using stale metadata to read from ETS while a concurrent flush was clearing the ETS buffer. The fix detects both empty and partial ETS reads and retries with fresh metadata, which will correctly read from disk after the flush completes.
