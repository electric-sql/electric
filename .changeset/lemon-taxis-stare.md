---
"@core/sync-service": patch
---

Avoid stopping the beam process when an unrecoverable error is encountered. Instead, stop the main OTP supervisor. Required for multi-tenancy.
