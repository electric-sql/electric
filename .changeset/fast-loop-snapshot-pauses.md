---
'@electric-sql/client': patch
---

Stop subset snapshots from tripping fast-loop detection. Requests aborted by a
snapshot pause no longer count, so a stream that serves many snapshots before
it is up to date is no longer torn down with "Client is stuck in a fast retry
loop".
