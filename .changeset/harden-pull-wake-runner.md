---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents': patch
---

Harden pull-wake runner lifecycle with a state machine, concurrent claim limits (`maxConcurrentClaims`), and exponential reconnect backoff (1s–30s). Add granular `status` field to `PullWakeRunnerHealth` (`stopped | starting | connecting | streaming | reconnecting | stopping`). The `onError` callback is now reporting-only (`(Error) => void`) — it can no longer control runner lifecycle. `stop()` rethrows `drainWakes` errors so callers observe wake handler failures. Event-driven heartbeat throttling avoids stale diagnostics between fixed-interval heartbeats.
