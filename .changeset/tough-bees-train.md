---
"@core/sync-service": patch
---

Fix race that caused the same `global_last_seen_lsn` to appear on two subsequent, but different, up-to-date responses by determining it at the start of the request processing pipeline.
