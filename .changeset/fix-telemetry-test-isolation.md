---
"@core/sync-service": patch
---

Test-only: make the StackSupervisor telemetry test synchronous to avoid serve_shape counter contamination from concurrently running tests. No runtime changes.
