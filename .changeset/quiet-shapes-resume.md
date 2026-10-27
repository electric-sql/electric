---
"@electric-sql/client": patch
---

Prevent concurrent ShapeStream request loops when pause/resume overlaps async request setup or error recovery. Preserve paused state through retries and resume with a non-live catch-up request after auth resolution.
