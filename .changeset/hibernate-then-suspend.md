---
'@core/sync-service': minor
---

Add hibernate-then-suspend behavior for Consumer processes. When suspend is enabled, consumers now hibernate first (triggering GC) before suspending. Adds `shape_suspend_after` config (default 60s) to control the delay between hibernation and suspension. Any activity cancels the pending suspend timer, restarting the cycle.
