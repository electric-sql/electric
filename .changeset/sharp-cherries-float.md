---
'@core/sync-service': patch
---

Set write_concurrency to :auto for all ETS tables that already have it enabled. This is the recommended setting, per OTP docs.
