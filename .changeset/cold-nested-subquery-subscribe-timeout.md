---
"@core/sync-service": patch
---

Fix a cold nested subquery shape returning an initial HTTP 500 while its dependency snapshots were still in progress. When an outer shape's consumer initialized, it subscribed to each dependency materializer using `GenServer.call` with the default 5s timeout. A dependency materializer stays blocked in start-up until its own snapshot starts, so if that snapshot took longer than 5s the subscribe timed out, the outer shape was removed, and the client's first request 500'd (a retry succeeded once the snapshot finished). The subscribe now waits with `:infinity`, consistent with the other materializer calls, so a cold nested shape waits for its dependency materializers and completes without an externally visible 500. Liveness is unaffected: the caller already monitors the materializer, so a dead dependency surfaces as a call exit rather than being masked by a short timeout.
