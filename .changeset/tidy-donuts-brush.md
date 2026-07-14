---
"@core/sync-service": patch
---

Add `ELECTRIC_TCP_READ_TIMEOUT` to configure the socket read / HTTP keep-alive
idle timeout (ThousandIsland's `read_timeout`, default 60s). When Electric runs
behind a connection-pooling proxy such as an AWS ALB, this must be set above
the proxy's idle timeout — otherwise the proxy races Electric's unannounced
idle close when reusing a pooled connection and clients see intermittent 502s.
