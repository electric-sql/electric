---
"@core/sync-service": patch
---

Fix dependency tracking for nested subqueries when intermediate rows change their linking column without changing the tracked column. Previously, such updates were incorrectly filtered out, causing stale tag tracking that led to incorrect row deletions when the old parent lost its qualifying status.
