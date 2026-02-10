---
'@electric-sql/client': patch
---

Add PauseLock to coordinate pause/resume across visibility changes and snapshot requests, preventing race conditions where one subsystem's resume could override another's pause.
