---
'@electric-sql/client': patch
---

Fix wake detection not re-arming after snapshot pause/resume. In daemon flows using `requestSnapshot` with `changes_only` mode, the wake detection timer was torn down during the pause but never re-armed on resume, causing the stream to behave as if wake detection was never enabled.
