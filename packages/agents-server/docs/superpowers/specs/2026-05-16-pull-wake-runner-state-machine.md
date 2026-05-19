# Pull-Wake Runner State Machine

## Status

Proposed design for review.

## Summary

Refactor the pull-wake runner lifecycle into an explicit state machine. The
machine owns runner transport and liveness concerns only: wake-stream
connection, offset tracking, runner heartbeat, claim attempts, dispatch into the
runtime, diagnostics, and shutdown.

Entity wake execution remains outside this machine. The runner machine dispatches
claimed wake notifications to the runtime via `runtime.dispatchWake(...)`; the
runtime continues to execute those wakes through the shared `processWake`
workflow.

The machine context becomes the single source of truth for
`PullWakeRunner.getHealth()`. Heartbeats continue to send that health snapshot
to agents-server as `runners.diagnostics`, which feeds the existing health
endpoint and desktop UI.

## Goals

- Make the runner lifecycle legible and testable as explicit states and events.
- Prevent runner stream consumption from blocking on an entity wake's idle
  window.
- Preserve the existing health check contract: `getHealth()` returns the
  diagnostics that heartbeat persists to the server.
- Keep pull-wake and webhook wake execution unified through `processWake`.
- Make reconnect, heartbeat, and shutdown behavior easier to reason about.

## Non-Goals

- Do not rewrite `processWake` as a state machine.
- Do not change Durable Streams claim semantics.
- Do not change runner registration, authorization, or ownership semantics.
- Do not add runner-level scheduling policy beyond claim and dispatch.
- Do not wait for in-flight entity wakes before reading the next runner wake
  event.

## Current Boundary

### Runner Lifecycle

Implemented by `createPullWakeRunner` in
`packages/agents-runtime/src/pull-wake-runner.ts`.

Responsibilities:

- Open the runner wake stream.
- Track the current wake stream offset.
- Heartbeat runner liveness and diagnostics to agents-server.
- Claim compact wake events.
- Dispatch full `WakeNotification` objects into the runtime.
- Abort stream reading and in-flight wakes during stop.
- Drain in-flight wakes during stop after aborting.

### Wake Execution

Implemented by `processWake` in
`packages/agents-runtime/src/process-wake.ts`.

Responsibilities:

- Claim callback lifecycle for the specific wake.
- Preload and tail the entity stream.
- Invoke the entity handler.
- Idle and resume inside one claimed wake when fresh entity work arrives.
- Persist manifest changes.
- Ack consumed stream offsets through the done callback.
- Cleanup entity-stream DBs, producers, and secondary streams.

## Design Principle

The runner lifecycle must not contain a `processingWake` state that blocks the
wake stream. Claim and dispatch are short side effects. Entity execution is an
independent spawned workflow tracked by the runtime.

This is the key invariant:

> A claimed wake dispatch must not prevent the runner from reading and claiming
> subsequent wake events.

## Offset Commit Policy

The runner uses read-commit semantics for the runner wake stream offset.

`wake_stream_offset` is a delivery cursor for compact runner wake events, not a
work-completion cursor. Work ownership and completion are tracked by server-side
wake, subscription, and claim state.

There are two separate recovery paths:

1. If a runner crashes after reading a compact wake event but before attempting
   to claim it, there is no claim lease yet. Recovery depends on the server
   continuing to treat that work as unclaimed pending work and emitting another
   compact wake notification for it.
2. If a runner crashes after successfully claiming work but before dispatching
   or completing it, recovery depends on the server-side claim lease expiring and
   the server re-emitting the pending work.

Consequences:

- The runner may update its local `offset` when `response.offset` advances.
- Heartbeat may persist that read-committed `offset` as `wake_stream_offset`.
- The runner does not need a contiguous claim-safe or dispatch-safe offset
  commit log.
- Entity wake completion must not gate runner wake-stream offset progress.
- Pre-claim crashes are recovered through server pending-work re-emission, not
  by rewinding the runner wake stream cursor.
- Post-claim failures are recovered through server claim lease expiry and
  re-emission.

This policy depends on the server contract that unresolved pending work is
re-emitted both when it remains unclaimed after a missed notification and when a
claim expires. If the server does not provide both guarantees, the runner must
not persist offsets past wake events that have not at least reached a claim
attempt.

## State Model

### Top-Level States

```txt
stopped
starting
running
  connecting
  streaming
  reconnecting
stopping
```

### State Descriptions

| State                  | Description                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `stopped`              | No stream, no heartbeat timer, no active abort controller.                                                           |
| `starting`             | Allocating controller, setting `started_at`, starting heartbeat, preparing the first stream connection.              |
| `running.connecting`   | Starting the long-running wake stream actor at the current offset.                                                   |
| `running.streaming`    | Wake stream is connected and being consumed.                                                                         |
| `running.reconnecting` | Previous stream failed or closed unexpectedly; wait for backoff before reconnect.                                    |
| `stopping`             | Abort stream, stop accepting claim actors, abort or gate in-flight claim actors, then abort and drain runtime wakes. |

There is intentionally no steady-state `failed` state. The runner is a service
process and should keep trying to run until `stop()` is called. Errors are
recorded in diagnostics and reported through `onError`, then the machine
continues or reconnects as appropriate.

## Events

### External Events

| Event   | Payload | Description                                        |
| ------- | ------- | -------------------------------------------------- |
| `START` | none    | Start the runner. Ignored unless `stopped`.        |
| `STOP`  | none    | Stop the runner. Valid from any non-stopped state. |

### Stream Events

| Event           | Payload        | Description                                              |
| --------------- | -------------- | -------------------------------------------------------- |
| `STREAM_OPENED` | `{ response }` | Durable stream reader is connected.                      |
| `STREAM_EVENT`  | `{ event }`    | Compact wake event received from the runner wake stream. |
| `STREAM_OFFSET` | `{ offset }`   | Stream response offset advanced.                         |
| `STREAM_CLOSED` | none           | Stream ended without explicit stop.                      |
| `STREAM_ERROR`  | `{ error }`    | Stream connection/read failed.                           |

### Heartbeat Events

| Event                | Payload         | Description                                                          |
| -------------------- | --------------- | -------------------------------------------------------------------- |
| `HEARTBEAT_INTERVAL` | none            | Machine-owned delayed transition that invokes one heartbeat request. |
| `HEARTBEAT_OK`       | `{ at }`        | Heartbeat succeeded.                                                 |
| `HEARTBEAT_ERROR`    | `{ error, at }` | Heartbeat failed.                                                    |

### Claim/Dispatch Events

| Event              | Payload                | Description                                         |
| ------------------ | ---------------------- | --------------------------------------------------- |
| `CLAIM_STARTED`    | `{ at }`               | Claim request started.                              |
| `CLAIM_EMPTY`      | `{ at }`               | Claim returned no work/already claimed.             |
| `CLAIM_FAILED`     | `{ error, at }`        | Claim failed.                                       |
| `CLAIMED`          | `{ notification, at }` | Claim returned a full wake notification.            |
| `DISPATCH_SKIPPED` | `{ reason, at }`       | Claim succeeded but shutdown began before dispatch. |
| `DISPATCHED`       | `{ at }`               | Notification was passed to `runtime.dispatchWake`.  |

## Context

The machine context should contain every field needed to derive
`PullWakeRunnerHealth`.

```ts
interface PullWakeRunnerMachineContext {
  runnerId: string
  baseUrl: string
  wakeUrl: string
  heartbeatUrl: string
  claimUrl: string

  offset?: string
  startedAt: string | null
  streamConnected: boolean
  streamConnectedSince: string | null
  reconnectCount: number
  lastError: string | null
  lastErrorAt: string | null
  lastHeartbeatAt: string | null
  lastHeartbeatOk: boolean
  lastClaimAt: string | null
  lastClaimResult: 'claimed' | 'no_work' | 'error' | null
  lastDispatchAt: string | null
  eventsReceived: number
  claimsSucceeded: number
  claimsSkipped: number
  claimsFailed: number
  claimActors: Set<Promise<void>>

  response: PullWakeStreamResponse | null
  abortController: AbortController | null
}
```

Claim actors are tracked for shutdown only. The runner dispatches claimed wakes
to the runtime and does not try to limit entity wake execution concurrency.

## `getHealth()` Mapping

`getHealth()` reads machine state and context only. It should not inspect local
variables outside the machine.

```ts
function getHealth(snapshot: PullWakeRunnerSnapshot): PullWakeRunnerHealth {
  return {
    running: snapshot.matches('running') || snapshot.matches('starting'),
    offset: snapshot.context.offset,
    started_at: snapshot.context.startedAt,
    stream_connected: snapshot.context.streamConnected,
    stream_connected_since: snapshot.context.streamConnectedSince,
    reconnect_count: snapshot.context.reconnectCount,
    last_error: snapshot.context.lastError,
    last_error_at: snapshot.context.lastErrorAt,
    last_heartbeat_at: snapshot.context.lastHeartbeatAt,
    last_heartbeat_ok: snapshot.context.lastHeartbeatOk,
    last_claim_at: snapshot.context.lastClaimAt,
    last_claim_result: snapshot.context.lastClaimResult,
    last_dispatch_at: snapshot.context.lastDispatchAt,
    events_received: snapshot.context.eventsReceived,
    claims_succeeded: snapshot.context.claimsSucceeded,
    claims_skipped: snapshot.context.claimsSkipped,
    claims_failed: snapshot.context.claimsFailed,
  }
}
```

Heartbeat sends this same snapshot as `diagnostics`.

## Transition Sketch

```txt
stopped
  START -> starting

starting
  entry:
    - create AbortController
    - set startedAt
    - schedule heartbeat tick
  always -> running.connecting

running.connecting
  invoke wakeStreamActor
  STREAM_OPENED -> running.streaming / assign response, streamConnected=true
  STREAM_ERROR -> running.reconnecting / record error, reconnectCount++
  STREAM_CLOSED -> running.reconnecting / streamConnected=false

running
  after heartbeat interval -> invoke sendHeartbeat
  STOP -> stopping

running.streaming
  STREAM_EVENT -> spawn claimAndDispatch(event), eventsReceived++
  STREAM_OFFSET -> assign offset
  STREAM_CLOSED -> running.reconnecting / streamConnected=false
  STREAM_ERROR -> running.reconnecting / record error, reconnectCount++

running.reconnecting
  after backoff -> running.connecting

stopping
  entry:
    - abort controller
    - cancel stream response
    - stop accepting new claim actors
    - abort in-flight claim actors
    - wait for claim actors that can still dispatch to settle or skip dispatch
    - runtime.abortWakes()
  invoke runtime.drainWakes
    done -> stopped / clear response/controller/stream state
    error -> stopped / record error, report error
```

`claimAndDispatch` is a spawned actor, not a parent state. It sends diagnostic
events back to the runner machine. `sendHeartbeat` is different: it is a
short-lived invocation scheduled by the machine on a heartbeat interval, not a
peer long-running actor.

## Actor Sketches

### `wakeStreamActor`

Input:

- `wakeUrl`
- headers provider
- current offset
- abort signal

Output:

- `PullWakeStreamResponse`

Behavior:

- Resolve headers and open `DurableStream.stream({ live: true, json: true, offset })`.
- Emit `STREAM_OPENED` after the stream response is available.
- Iterate `response.jsonStream()`.
- For each wake event, emit `STREAM_EVENT`.
- After each iteration, if `response.offset` is defined, emit `STREAM_OFFSET`.
- On clean close, emit `STREAM_CLOSED`.
- On error, emit `STREAM_ERROR` unless stopped/aborted.
- Return only when the stream loop exits due to stop/abort, normal close, or
  error. This is not a one-shot "open connection" actor; it owns consumption for
  the lifetime of the connection.

### `sendHeartbeat`

`sendHeartbeat` is a short-lived invoked actor. The machine owns the repeated
schedule using an `after` delay or equivalent timer. The actor owns only one HTTP
request.

Input:

- heartbeat URL
- headers provider
- lease ms
- current offset
- `getHealth()` snapshot
- abort signal

Behavior:

- POST `{ lease_ms, wake_stream_offset, diagnostics }`.
- Emit `HEARTBEAT_OK` or `HEARTBEAT_ERROR`.

### `claimAndDispatch`

Input:

- compact `PullWakeEvent`
- claim URL
- headers provider
- runtime dispatch function
- claim token header config
- abort signal

Behavior:

1. Emit `CLAIM_STARTED`.
2. POST compact wake event to claim endpoint.
3. If response is 204, 409 `ALREADY_CLAIMED`, or 409 `NO_PENDING_WORK`, emit
   `CLAIM_EMPTY`.
4. If response is an error, emit `CLAIM_FAILED`.
5. If response contains `{ done: true }`, emit `CLAIM_EMPTY`.
6. Otherwise emit `CLAIMED`.
7. Check the shutdown gate. If stop has begun, do not call
   `runtime.dispatchWake`; emit `DISPATCH_SKIPPED` and rely on server claim
   lease expiry or an explicit release API if one exists.
8. Otherwise call
   `runtime.dispatchWake(notification, { claimHeaders, claimTokenHeader })`.
9. Emit `DISPATCHED`.

It must not call `runtime.drainWakes()`.

## Diagnostics Updates

| Event              | Context Update                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `START`            | `startedAt = now`                                                                                        |
| `STREAM_OPENED`    | `streamConnected = true`, `streamConnectedSince = now`                                                   |
| `STREAM_CLOSED`    | `streamConnected = false`, `streamConnectedSince = null`                                                 |
| `STREAM_ERROR`     | `streamConnected = false`, `streamConnectedSince = null`, `lastError`, `lastErrorAt`, `reconnectCount++` |
| `STREAM_EVENT`     | `eventsReceived++`                                                                                       |
| `STREAM_OFFSET`    | `offset = event.offset`                                                                                  |
| `HEARTBEAT_OK`     | `lastHeartbeatAt = now`, `lastHeartbeatOk = true`                                                        |
| `HEARTBEAT_ERROR`  | `lastHeartbeatAt = now`, `lastHeartbeatOk = false`, `lastError`, `lastErrorAt`                           |
| `CLAIM_STARTED`    | `lastClaimAt = now`, `lastClaimResult = null`                                                            |
| `CLAIM_EMPTY`      | `lastClaimResult = 'no_work'`, `claimsSkipped++`                                                         |
| `CLAIM_FAILED`     | `lastClaimResult = 'error'`, `claimsFailed++`, `lastError`, `lastErrorAt`                                |
| `CLAIMED`          | `lastClaimResult = 'claimed'`, `claimsSucceeded++`                                                       |
| `DISPATCH_SKIPPED` | `claimsSkipped++`                                                                                        |
| `DISPATCHED`       | `lastDispatchAt = now`                                                                                   |

## Concurrency Rules

1. The stream reader may continue while one or more `claimAndDispatch` actors
   are in flight.
2. The runner does not wait for entity wake execution after dispatch.
3. The runner does not expose a claim concurrency limit. Backpressure belongs
   in runtime wake execution or the Durable Streams lease/claim contract.
4. Stop aborts future stream reads and claim requests.
5. Stop prevents any claim actor from dispatching after shutdown begins. A claim
   actor that has already received a notification must either dispatch before
   runtime drain begins or skip dispatch and rely on server claim lease expiry.
6. Stop gates and aborts claim actors before calling `runtime.abortWakes()` and
   `runtime.drainWakes()`.
7. Claim actors must use the runner abort signal so stop can cancel in-flight
   claim requests.
8. If two compact wake events race for the same work, the claim endpoint remains
   authoritative. One may return `claimed`; the other may return `no_work`.
9. Offset progress follows the read-commit policy; claim actor completion does
   not block `wake_stream_offset` advancement.

## Error Handling

`onError` is reporting-only. It exists so a host such as the Electron desktop
process can write errors to its own logs. It must not decide runner lifecycle.

The runner should always try to stay alive until `stop()` is called. Operational
errors are written to diagnostics, reported through `onError`, and then handled
with the most local recovery action.

Recommended handling:

| Error Source     | Recovery Behavior                                                      |
| ---------------- | ---------------------------------------------------------------------- |
| Stream open/read | Record error, increment reconnect count, transition to `reconnecting`. |
| Heartbeat        | Record degraded diagnostics, continue streaming.                       |
| Claim            | Record claim failure, continue streaming.                              |
| Dispatch         | Record error if synchronous dispatch throws, continue streaming.       |
| Stop drain       | Record/report error and finish stopping.                               |

`onError` callback shape:

```ts
onError?: (error: Error) => void
```

The current boolean return value should be removed as part of this refactor.
Desktop introspection comes from `getHealth()` and persisted
`runners.diagnostics`, not from `onError`.

## Public API

The `PullWakeRunner` interface can remain source-compatible except for internal
implementation details.

```ts
export interface PullWakeRunner {
  start: () => void
  stop: () => Promise<void>
  waitForStopped: () => Promise<void>
  readonly running: boolean
  readonly offset: string | undefined
  getHealth: () => PullWakeRunnerHealth
}
```

`running` should be derived from machine state:

- true for `starting` and `running.*`
- false for `stopped` and `stopping`

`waitForStopped()` should resolve when the interpreter reaches `stopped`.

## Testing Requirements

### Unit Tests

- Starts in `stopped`; `start()` reaches `running.streaming`.
- `getHealth()` reflects state and context after start.
- Stream wake event spawns claim and dispatch without calling
  `runtime.drainWakes()`.
- A second wake event can be claimed and dispatched while the first runtime wake
  is still pending.
- Claim 204 and 409 no-work update `claimsSkipped`.
- Claim failure updates `claimsFailed` and `lastError`, reports through
  `onError`, and does not stop stream consumption.
- Heartbeat success stores `lastHeartbeatOk = true`.
- Heartbeat failure stores `lastHeartbeatOk = false` and continues stream.
- Stream error transitions through `reconnecting` and increments
  `reconnectCount`.
- `stop()` aborts stream/claims, calls `runtime.abortWakes()`, then drains.

### Integration Tests

- Built-in desktop runtime registers runner, heartbeats diagnostics, and the UI
  receives diagnostics through the `runners` Electric shape.
- Sending to one entity while another entity is idling does not wait for the
  idling entity's timeout before claim/dispatch.

## Migration Plan

1. Introduce the machine behind `createPullWakeRunner` without changing the
   public interface.
2. Keep the existing `PullWakeRunnerHealth` shape unchanged.
3. Replace mutable local diagnostics with machine context.
4. Keep the heartbeat request body unchanged except that diagnostics now come
   from `getHealth()`.
5. Update stop ordering: abort stream, stop accepting claim actors, abort or
   wait for claim actors to dispatch or skip, then call `runtime.abortWakes()`
   and `runtime.drainWakes()`.
6. Make `onError` reporting-only; remove the boolean lifecycle contract.
7. Add tests for non-blocking claim/dispatch before refactoring deeper.

## Open Questions

- Should `running` return true while `stopping` drains existing wakes?
- Should reconnect backoff remain delegated to Durable Streams, or be modeled
  explicitly in this runner machine?
