---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents': patch
---

Harden pull-wake runner lifecycle with a state machine, concurrent claim limits (`maxConcurrentClaims`), heartbeat-driven stream resets, and exponential reconnect backoff (1s–30s). Add granular `status` field to `PullWakeRunnerHealth` (`stopped | starting | connecting | streaming | reconnecting | stopping`). The `onError` callback is now reporting-only (`(Error) => void`) — it can no longer control runner lifecycle. `stop()` rethrows `drainWakes` errors so callers observe wake handler failures. Event-driven heartbeat throttling avoids stale diagnostics between fixed-interval heartbeats. Service-scoped Durable Streams clients now route subscription control through `__ds` while preserving tenant-prefixed stream names, so pull-wake subscriptions emit runner wake events correctly.
