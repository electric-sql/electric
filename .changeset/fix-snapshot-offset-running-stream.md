---
'@electric-sql/client': patch
---

Fix `requestSnapshot()` skipping changes in `changes_only` mode. It moved the stream to the snapshot's offset even when the stream was already running, and a subset snapshot only covers its own rows, so changes to other rows logged in between were never delivered. The stream now only takes a snapshot's offset on a cold start, and resumes from the earliest of the snapshots started then, including a new shape's `0_inf`.
