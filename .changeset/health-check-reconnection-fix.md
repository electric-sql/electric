---
"@core/sync-service": patch
---

Add test coverage for health check behavior when shape pipeline survives a DB connection drop, documenting that `{conn: :waiting_on_lock, shape: :up}` correctly maps to `:starting` because serving read-only during reconnection is unsafe while Connection.Manager is restarting.
