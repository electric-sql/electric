---
"@core/sync-service": patch
---

Fix out-of-bounds request handler to subscribe to shape events before entering the live request wait loop. Without the subscription, non-live requests that hit the out-of-bounds guard would hang for the full timeout duration (long_poll_timeout/2) instead of recovering when the expected offset becomes available.
