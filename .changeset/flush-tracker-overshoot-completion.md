---
'@core/sync-service': patch
---

Fix flush-boundary accounting for shapes that append log entries past the transaction boundary (subquery move-in/move-out control messages). The consumer's flush-offset alignment now carries a dropped transaction boundary forward when the storage flush lands past the mapped written offset, and FlushTracker treats a notification at or past its recorded last-sent offset as completion instead of requiring exact equality. Previously such shapes' flush entries could pin forever in either direction, dragging the stack-wide flush boundary (WAL retention) and — since the stall watchdog was added — getting healthy shapes removed after 60s of quiet WAL, seen as spurious 409s for optimized subquery shapes after rolling deploys.
