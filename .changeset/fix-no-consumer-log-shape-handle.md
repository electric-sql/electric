---
'@core/sync-service': patch
---

Emit `shape_handle` as Logger metadata (instead of interpolating it into the message body) for the "No consumer process when waiting on initial snapshot creation" error. This keeps the message text static so Sentry can deduplicate these events properly during incidents.
