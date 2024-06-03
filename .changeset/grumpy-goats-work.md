---
"@core/electric": patch
---

The sync service now exits when a database connector fails to initialise. Previously, some initialisation errors would result in Electric running without a single database connection and not logging any erors about that.
