---
"@electric-sql/client": patch
---

Add a live request watchdog and abortable retry backoff so ShapeStream can recover when mobile fetch implementations hang or delay reconnects across app lifecycle transitions.
