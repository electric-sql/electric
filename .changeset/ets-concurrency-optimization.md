---
'@core/sync-service': patch
---

Enable read and write concurrency for ETS tables to improve performance under concurrent workloads. Added `write_concurrency: true` to ShapeStatus tables (LastUsedTable and MetaTable) to reduce lock contention during concurrent shape operations, addressing slow deletes with large numbers of shapes. Also added appropriate concurrency options to other high-traffic tables including StatusMonitor, EtsInspector, CallHomeReporter, RefCounter, StackConfig, InMemoryStorage, and PureFileStorage.
