---
"@core/sync-service": patch
---

Fix race condition crash in DependencyLayers when a dependency shape is removed before its dependent shape is registered.

When a dependency shape's materializer crashes and is removed while a dependent shape is being added, `DependencyLayers.add_after_dependencies/3` would crash with a `FunctionClauseError` due to a missing clause for exhausted layers with unfound dependencies. This would take down the ShapeLogCollector and cascade into OOM failures.

`add_dependency/3` now returns `{:ok, layers}` or `{:error, {:missing_dependencies, missing}}`, and the ShapeLogCollector handles the error case gracefully instead of crashing.
