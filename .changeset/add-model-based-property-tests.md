---
'@electric-sql/client': patch
---

Add fast-check model-based and micro-target property tests (plus static analysis for unbounded retry loops) and fix eight client bugs uncovered by the new PBT suite: `canonicalShapeKey` collapsing duplicate query params, `Shape#process` clobbering notifications, `subset__limit=0`/`offset=0` dropped on GET, non-canonical JSON keys in snapshot re-execute dedup, `snakeToCamel` colliding multi-underscore columns, `Shape#reexecuteSnapshots` swallowing errors silently, `SnapshotTracker` leaving stale reverse-index entries on re-add/remove, and `Shape#awaitUpToDate` hanging forever on a terminally-errored stream.
