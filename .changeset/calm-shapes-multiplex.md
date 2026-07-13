---
"@core/sync-service": minor
---

Add an authenticated, active-instance-only WebSocket endpoint for multiplexing
silent live shape waits. The endpoint coalesces change subscriptions by shape,
wakes proxies without routing shape data through the socket, and reproduces
normal empty live responses when Electric's configured deadline expires.
