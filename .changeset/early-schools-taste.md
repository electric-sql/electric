---
"electric-sql": patch
---

Fix Capacitor driver issue where `BEGIN` statements failed to run on Android by using driver's `execute` API.
