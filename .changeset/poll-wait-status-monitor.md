---
'@core/sync-service': patch
---

Add a load-resilience backstop that bounds `StatusMonitor`'s mailbox growth under excessive load. When many requests wait on a not-ready stack (e.g. during a cold-start traffic burst), the mailbox-based `StatusMonitor.wait_until/3` path can pile up unboundedly. Now, once the StatusMonitor's waiter set crosses a fixed congestion threshold, callers switch from the `GenServer.call` wait to per-process polling via `Electric.PollWait.until/3` against `service_status/1`, capping mailbox growth at the threshold regardless of offered load. Uncongested callers keep using `GenServer.call` for low-latency wakeup. The bound is structural and holds independently of any configurable admission limits.
