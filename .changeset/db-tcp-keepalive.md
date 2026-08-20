---
"@core/sync-service": patch
---

Add `ELECTRIC_DATABASE_TCP_KEEPALIVE_IDLE`, `ELECTRIC_DATABASE_TCP_KEEPALIVE_INTERVAL`, `ELECTRIC_DATABASE_TCP_KEEPALIVE_COUNT` and `ELECTRIC_DATABASE_TCP_USER_TIMEOUT` for configuring TCP keepalive and user timeout on database connections. All of them are opt-in; when unset the OS defaults are kept.
