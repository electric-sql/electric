---
'@electric-sql/client': patch
---

Fix on-demand mode (`offset: "now"`) to advance the stream's offset/handle after a cold-start `requestSnapshot()`, so the stream resumes from the snapshot's position rather than the stale `"now"` offset. Prevents updates committed between the snapshot and the stream's next live poll from being missed.
