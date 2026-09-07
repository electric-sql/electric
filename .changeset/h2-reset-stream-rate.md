---
"@core/sync-service": patch
---

Disable Bandit's HTTP/2 reset-stream rate limit by default and expose it as
`ELECTRIC_TWEAKS_HTTP2_MAX_RESET_STREAM_RATE`. The limit closes an entire
connection once a client sends more than 500 `RST_STREAM` frames in 10 seconds,
dropping every request in flight on it. Behind a proxy that multiplexes many end
clients onto a few upstream connections, routine client-side cancellations of
live requests were enough to trip it, killing the parked long-polls of unrelated
clients and leaking their admission permits.
