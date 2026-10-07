---
'@electric-sql/client': patch
---

Keep a live stream's offset when `requestSnapshot()` returns. The snapshot
response's offset is ahead of the stream's, so moving the stream there skipped
every change committed in between that the snapshot's subset didn't contain.
A snapshot now only moves the stream to an earlier offset: a stream still at
`"now"` (a snapshot requested before the first response) takes the snapshot's
offset, concurrent cold-start snapshots keep the earliest one, and a live
stream keeps its own.
