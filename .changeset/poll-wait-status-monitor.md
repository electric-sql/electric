---
'@core/sync-service': patch
---

When many requests wait on a not-ready stack (e.g. during a cold-start traffic burst), the mailbox-based `StatusMonitor.wait_until/3` path can pile up unboundedly. Now, once the StatusMonitor's waiter set crosses a fixed congestion threshold, callers switch from the `GenServer.call` wait to per-process polling via `Electric.PollWait.until/3` against `service_status/1`. The threshold flag is set reactively as the monitor processes waiters, so a simultaneous burst can transiently overshoot it, but sustained waiter accumulation is bounded: once the flag flips, subsequent arrivals poll instead of enqueuing. Uncongested callers keep using `GenServer.call` for low-latency wakeup.
