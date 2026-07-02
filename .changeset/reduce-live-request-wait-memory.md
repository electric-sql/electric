---
'@core/sync-service': patch
'@core/electric-telemetry': patch
---

Reduce memory retained by live shape requests while they wait for changes.

Remove a dead SystemMonitor timer branch that fails warnings-as-errors on Elixir 1.20.
