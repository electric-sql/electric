# Desktop Sleep/Resume Pull-Wake Recovery

## Problem

Closing and reopening a laptop can leave the Node/Electron Durable Streams long-poll used by the pull-wake runner pending on a stale socket. The Durable Streams client retries rejected requests, but a request that never settles gives its retry loop no opportunity to reconnect. Restarting the complete built-in runtime replaces the connection, but also risks interrupting active LLM and tool work.

This change is limited to the Electric Agents repository. A client-side request deadline in Durable Streams remains appropriate upstream work, but is outside this branch.

## Goals

- Reconnect the pull-wake subscription immediately when Electron reports system resume.
- Preserve active wake handlers, LLM calls, tool calls, and child runs.
- Resume the stream from the pull-wake runner's current offset.
- Make repeated or overlapping resume signals safe and idempotent.
- Retain the existing heartbeat-gap detector as a platform-independent fallback.

## Non-goals

- Restarting the entire `BuiltinAgentsServer` on every resume.
- Adding timeout escalation or runtime health supervision.
- Modifying the Durable Streams repository or package.
- Changing wake routing, claim leases, or server recovery policy.

## Design

### Pull-wake runner

Expose an explicit reconnect operation on `PullWakeRunner`. Calling it sends the existing state machine a stream-reset event. The state machine aborts the current Durable Streams request and follows its normal reconnect path using the runner's in-memory committed offset.

The operation does not stop the runner, clear deferred wake notifications, or call `runtime.abortWakes()`. Existing wake handlers continue running. Calls made while stopped are no-ops. Multiple reset requests while a reset is already in progress must not create parallel stream readers.

The existing elapsed-heartbeat-gap reset remains unchanged and acts as defense in depth for non-Electron runtimes and missed power events.

### Built-in agents server

Add a public `reconnectPullWake()` method to `BuiltinAgentsServer`. It delegates to the current pull-wake runner when one exists and otherwise returns without error. This gives embedders a narrow recovery API without exposing runner internals or restarting the rest of the runtime.

### Desktop lifecycle

Register Electron `powerMonitor` listeners after `app.whenReady()`:

- `suspend`: record/log the event only.
- `resume`: iterate current runtime entries and call `reconnectPullWake()` only for entries whose desired state is connected, whose local runtime is enabled/running, and whose runtime instance exists.

The listener delegates through the desktop controller/runtime lifecycle boundary rather than reaching into context state from `main.ts`. Registration happens once per desktop process. Shutdown removes listeners or relies on a single process-lifetime registration, with tests proving duplicate registration does not occur.

A resume does not call `startRuntime()` or stop the current runtime. Existing reconnect timers and startup state remain independent.

## Data flow

1. macOS wakes after lid-open.
2. Electron emits `powerMonitor.resume`.
3. Desktop lifecycle selects connected local runtime entries.
4. Each `BuiltinAgentsServer.reconnectPullWake()` delegates to its runner.
5. Runner sends `STREAM_RESET` to its state machine.
6. The stale fetch is aborted and the normal reconnect state opens one replacement stream.
7. The replacement request uses the runner's current offset; active wake processing continues independently.

## Error handling and observability

The resume handler is best-effort and handles each runtime independently so one failure cannot block others. It logs resume detection and reconnect failures with the server ID. Since reconnect initiation is synchronous/idempotent, no desktop-wide restart or retry policy is added. The runner's existing reconnect backoff and `onError` diagnostics remain authoritative.

## Testing

Tests follow red-green regression discipline:

1. **Pull-wake runner:** begin with a stream whose request remains pending, call explicit reconnect, and assert the request is aborted, exactly one replacement stream opens, and the last committed offset is reused. Repeated reconnect calls must not create parallel streams. Verify active runtime wakes are not aborted.
2. **BuiltinAgentsServer:** verify delegation when running and safe no-op behavior before startup and after shutdown.
3. **Desktop:** mock `powerMonitor`, emit resume, and verify only connected local running entries receive reconnect calls. Cover disconnected, disabled, absent, and starting runtimes, plus one-runtime failure isolation and single listener registration.
4. Keep the heartbeat-gap recovery test to prove the non-Electron fallback remains intact.

## Acceptance criteria

- Lid-open triggers pull-wake reconnection without restarting the built-in runtime.
- Active wake handlers remain active.
- Reconnection preserves cursor/offset continuity and opens no parallel stream readers.
- Ineligible desktop runtime entries are untouched.
- All new regression tests fail against the pre-change behavior and pass after implementation.
