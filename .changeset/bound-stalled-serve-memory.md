---
"@core/sync-service": patch
---

Bound the memory pinned by a shape response served to a slow or stalled client. Two compounding issues let every stalled connection pin its entire in-flight log chunk (~10 MB by default) for as long as the serve lived: the log file was read eagerly as one whole-range binary whose entries were served as sub-binary slices (pinning the full chunk plus the full entry list), and the JSON encoder batched response elements by item count only, so a batch of large rows grew into a multi-megabyte unit held in full by the request process and the socket's driver queue. Accumulated stalled serves could exhaust node memory (observed in production: ~400 stalled serves pinning ~3.9 GB, immune to GC since the references are live). The log is now read lazily in 64 KiB blocks and encoder batches are additionally capped at 256 KiB, bounding the pinned memory per stalled connection to well under 1 MB regardless of chunk size.
