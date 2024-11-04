---
"@core/sync-service": patch
---

Add tracing of snapshot creation and more logging of postgres connection status. Prevent connection timeouts when writing snapshot data. Add `LOG_OTP_REPORTS` environment variable to enable OTP SASL reporting at runtime.
