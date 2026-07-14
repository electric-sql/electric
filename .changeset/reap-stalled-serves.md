---
"@core/sync-service": patch
---

Terminate shape response serves whose clients stop accepting data. Serves to stalled clients never complete and are invisible to request telemetry, while pinning response memory and a file descriptor each for as long as the client's connection survives — a population of them exhausted a production node. Response bodies are now written to the socket in pieces of at most 256 KiB, and a watchdog terminates the serve when a single piece fails to complete within `ELECTRIC_STALLED_SERVE_TIMEOUT` (default 60s; 0 disables). A healthy client only needs to drain roughly one OS send buffer per timeout window to stay clear of the deadline, and a terminated client can reconnect and resume from its last offset. Oversized single body elements (e.g. one very large row) no longer enter the socket driver queue whole.
