---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
---

Fix two resilience bugs that could leave the desktop agents runtime unable to pick up sessions until a full app restart, and port the pull-wake runner lifecycle to an xstate state machine.

- `installDurableStreamsFetchCache` is now idempotent (with a warning on repeat calls), so restarting the built-in agents runtime no longer stacks duplicate HTTP cache interceptors on the global undici dispatcher.
- The pull-wake runner now recovers when the wake stream connection hangs during the connecting phase: repeated heartbeat failures abort the in-flight connection attempt instead of only resetting an already-established stream.
- The runner lifecycle (stopped → connecting → streaming → reconnecting → stopping) is now an xstate machine, so in-flight connections, stream sessions, and backoff timers are cancelled automatically on state transitions, and every state × event pair is pinned by an exhaustive transition test matrix.
