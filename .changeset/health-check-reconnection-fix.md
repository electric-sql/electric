---
"@core/sync-service": patch
---

Fix health check to correctly report "waiting" (202) during DB reconnection. When a connection drops while the service is active, the shape pipeline survives but `service_status` previously fell through to "starting" instead of "waiting", preventing read-only shape serving during reconnection.
