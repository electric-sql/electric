---
"@core/sync-service": patch
---

Stop applying `ELECTRIC_TWEAKS_CONN_MAX_REQUESTS` to HTTP/2 connections. The limit is only meaningful for HTTP/1, where it recycles long-lived handler processes at a request boundary. Under HTTP/2 it made Bandit tear down the whole multiplexed connection with GOAWAY/REFUSED_STREAM once the cumulative stream count reached the limit (50 by default), disrupting in-flight streams and causing reconnect bursts.
