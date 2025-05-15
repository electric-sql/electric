---
"@core/sync-service": patch
---

Fix a typo in the 'targets' option for telemetry deps, ensuring they are left out from compilation unless MIX_TARGET=application.
