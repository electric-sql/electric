---
'@electric-ax/durable-streams-server-rust': patch
---

Cut SSE fan-out per-subscriber memory by ~60%. Each live subscriber used to spawn a producer task and an mpsc channel and keep the whole connection state machine resident while parked. SSE is now produced inline (new pull-based `Body::Sse`) and the connection is handed to a small dedicated streaming task, so an idle subscriber's resident footprint collapses to roughly a cursor over the shared stream tail.

Live-tail SSE subscribers are then served from a fixed pool of epoll reactor threads instead of a parked connection task per subscriber. Each subscriber becomes a compact slab entry, so per-subscriber resident memory drops from ~7 KiB to ~0.6 KiB and stops scaling with the number of active connections. Linux only; other platforms keep the existing path.
