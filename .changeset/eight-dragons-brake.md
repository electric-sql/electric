---
"@core/sync-service": patch
---

JSON encoding on write rather than read to reduce memory footprint. For example the memory use of an initial sync of a 35MB/200k row table has been reduced from 50MB to 25MB on the first initial sync (which includes the encoding and the writing to storage) and to 6MB on subsequent initial syncs (where we just read from storage and there's no encoding).
