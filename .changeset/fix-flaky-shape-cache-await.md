---
"@core/sync-service": patch
---

Stop the `ShapeCache` "should wait for consumer to come up" test flaking under CI load. The test asserts the snapshot *eventually* starts once the consumer comes up, but its ~5s `Task.await` bound occasionally tripped when the shared Postgres instance and BEAM scheduler were briefly saturated by concurrent async tests. The bound is now generous-but-bounded (15s), absorbing load spikes while still failing reasonably fast on a genuine hang.
