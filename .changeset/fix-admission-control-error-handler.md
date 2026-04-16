---
'@core/sync-service': patch
---

Fix admission control permit leak in error handlers. `register_before_send` callbacks are not available in `Plug.ErrorHandler` because it uses the original conn, so permits must be released explicitly.
