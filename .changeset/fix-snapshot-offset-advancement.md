---
'@electric-sql/client': patch
---

Fix cold-start snapshot to advance the stream's offset/handle so the stream resumes from the snapshot's position rather than its pre-snapshot state. Prevents updates committed between the snapshot and the stream's first live request from being missed.
