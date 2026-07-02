---
"@electric-ax/durable-streams-server-rust": patch
---

perf: fix the high-stream-cardinality (200k–1M streams) write cliff — O(1) WAL
checkpoint drain, checkpoint fully off the async runtime with concurrent shards
and a resident tails map, meta sidecar flush moved from per-append to the
checkpoint, single registry lookup per append. 1M streams now sustains 1.11M
ops/s on 16 vCPU (was 862k, with 405 ms worst-case latency now 150 ms).
