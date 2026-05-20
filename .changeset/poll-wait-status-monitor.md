---
'@core/sync-service': patch
---

Replace the mailbox-based `StatusMonitor.wait_until/3` not-ready path with adaptive per-process polling once the StatusMonitor's waiter set crosses a congestion threshold (bottleneck 2 of #4266). The fast path (`:active`, `:waiting` + `:read_only`, `:sleeping`) is unchanged. Uncongested callers continue to use the existing `GenServer.call` for low-latency wakeup; congested callers switch to `Electric.PollWait.until/3` against `service_status/1`, bounding StatusMonitor mailbox growth to the threshold during cold-start bursts. No HTTP protocol change.
