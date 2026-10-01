---
'@electric-sql/client': patch
---

Keep a live stream's offset when `requestSnapshot()` returns. The snapshot
response's offset is ahead of the stream's, so moving the stream there skipped
every change committed in between that the snapshot's subset didn't contain.
The stream now only takes the snapshot's offset while it is still at `"now"`
(a snapshot requested before the first response), which is the cold start the
offset advancement was added for.
