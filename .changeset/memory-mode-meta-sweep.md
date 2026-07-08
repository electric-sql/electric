---
"@electric-ax/durable-streams-server-rust": patch
---

Memory-mode CPU fix: batch meta sidecar flushes into a periodic sweep (#4691).

`--durability memory` appends no longer schedule a per-stream debounced sidecar flush (a timer task + full sidecar rewrite per stream per 100 ms — ~5x wal-mode CPU at high stream cardinality under low per-stream rates). Appends and TTL read touches now only mark the stream dirty in a store-level set; a single 1 s sweeper flushes all dirty sidecars in one pass, mirroring the batched checkpoint treatment wal mode got in the write-path overhaul. The sidecar's producer/access state remains a non-durable lagging flush; its lag bound moves from 100 ms to the 1 s sweep cadence. Durable flush-on-close/delete paths are unchanged, and a pending flush can no longer resurrect the sidecar of a hard-deleted stream.
