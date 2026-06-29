---
'@electric-ax/durable-streams-server-rust': patch
---

Serve live-tail SSE subscribers from a fixed pool of epoll reactor threads instead of a parked connection task per subscriber. Each subscriber becomes a compact slab entry, so per-subscriber resident memory drops from ~7 KiB to ~0.6 KiB and stops scaling with the number of active connections. Linux only; other platforms keep the existing path.
