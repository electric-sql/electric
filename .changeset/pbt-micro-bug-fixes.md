---
'@electric-sql/client': patch
---

Fix eight client bugs uncovered by property-based testing: `canonicalShapeKey` losing duplicate query params, `Shape#process` clobbering notifications, `subset__limit=0`/`offset=0` being dropped, non-canonical JSON keys in snapshot re-execute dedup, `snakeToCamel` colliding multi-underscore columns, `Shape#reexecuteSnapshots` swallowing errors silently, `SnapshotTracker` leaving stale reverse-index entries on re-add/remove, and `Shape#awaitUpToDate` hanging forever on a terminally-errored stream.
