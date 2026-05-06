# ShapeStream State Machine Specification

Formal specification for the `ShapeStreamState` state machine in `@electric-sql/client`.
This document is the single source of truth for intended behavior. Tests are derived
from these invariants and constraints; the bidirectional checklist at the bottom
tracks enforcement.

## States

Seven states organized into three groups:

| Group    | State           | Kind          | Description                                    |
| -------- | --------------- | ------------- | ---------------------------------------------- |
| Fetching | InitialState    | `initial`     | No data yet; waiting for first response        |
| Fetching | SyncingState    | `syncing`     | Received first response; catching up to head   |
| Fetching | StaleRetryState | `stale-retry` | Response was stale; retrying with cache buster |
| Active   | LiveState       | `live`        | Up-to-date; streaming new changes              |
| Active   | ReplayingState  | `replaying`   | Re-fetching from cache after resume            |
| Delegate | PausedState     | `paused`      | Suspended; wraps previous state                |
| Delegate | ErrorState      | `error`       | Failed; wraps previous state + error           |

## Events

Ten events that can act on any state:

| Event             | Input                 | Notes                                   |
| ----------------- | --------------------- | --------------------------------------- |
| `response`        | ResponseMetadataInput | Server response headers arrived         |
| `messages`        | MessageBatchInput     | Message batch (may contain up-to-date)  |
| `sseClose`        | SseCloseInput         | SSE connection closed                   |
| `pause`           | (none)                | Client pauses the stream                |
| `resume`          | (none)                | Client resumes from pause               |
| `error`           | Error                 | Unrecoverable error occurred            |
| `retry`           | (none)                | Client retries from error               |
| `markMustRefetch` | handle?: string       | Server says data is stale; reset        |
| `withHandle`      | handle: string        | Update handle, preserve everything else |
| `enterReplayMode` | cursor: string        | Enter replay from cache                 |

## Transition Table

All 7 states x 10 events = 70 combinations are specified in `state-transition-table.ts`.
The type is `Record<ShapeStreamStateKind, Record<EventType, ExpectedBehavior>>` —
no `Partial`, so TypeScript enforces completeness at compile time.

### Summary of transitions

```
Initial ──response──► Syncing ──up-to-date──► Live
              │                                 │
              └──stale──► StaleRetry            │
                              │                 │
              Syncing ◄──response──┘            │
                                                │
Any ──────pause──────► Paused ───resume───► (previous)
Any ──────error──────► Error  ───retry────► (previous)
Any ──markMustRefetch─► Initial (offset = -1)
```

### No-op rules

- `resume` on a non-Paused state returns `this` (no-op)
- `retry` on a non-Error state returns `this` (no-op)
- `enterReplayMode(cursor)` returns `this` for states that don't support replay (base class default); callers should check `canEnterReplayMode()` first
- `pause` on PausedState returns `this` (idempotent)
- `messages`/`sseClose` on Paused return `this` (ignored)
- `response` on Paused delegates to `previousState`, preserving the Paused wrapper for `accepted` and `stale-retry` transitions; `ignored` returns `this`
- `response`/`messages`/`sseClose` on Error return `this` (ignored)

## Server Assumptions

Properties of the sync service that the client state machine depends on.

### S0: Shape handles are unique and never reused

The server generates handles as `{phash2_hash}-{microsecond_timestamp}`. Uniqueness
is enforced by monotonic timestamps, a SQLite `UNIQUE INDEX` on the handle column,
and ETS `insert_new` checks. Even after server restarts, old handles persist in
SQLite and new ones receive fresh timestamps, so collisions cannot occur.

**Implication for expired shapes cache**: Once a handle is marked expired (after a
409 response), the server will never issue that handle again. If a response contains
an expired handle, it must be coming from a caching layer (browser HTTP cache,
CDN, or proxy) — not from the server itself.

**Source**: `packages/sync-service/lib/electric/shapes/shape.ex` (`generate_id/1`),
`packages/sync-service/lib/electric/shape_cache/shape_status/shape_db/connection.ex`
(`shapes_handle_idx`).

## Client Transport Assumptions

Properties of the fetch/abort layer that must hold before a network result is
allowed to enter the state machine as a `response`, `messages`, or `sseClose`
event.

### T0: Aborted requests are quarantined

Once a request's `AbortSignal` is aborted, that request is no longer allowed to
deliver success metadata or message batches into the state machine, even if the
underlying runtime later resolves the fetch successfully.

This is a client-side requirement, not a server assumption. Some runtimes and
transport stacks can surface a late successful response after the caller has
already aborted the request, especially around pause/resume, refresh/reconnect,
or desktop-app lifecycle edges. If that late response is processed, it can race
with a newer request generation and violate the state machine's preconditions,
e.g. by delivering a `response` event after the stream has already transitioned
into `ErrorState`.

Operationally:

- Aborted requests must be converted into an abort outcome before returning from
  the fetch wrapper chain
- `#onInitialResponse`, `#onMessages`, and SSE close handling must only run for
  the currently active, non-aborted request generation

**Enforcement**: runtime checks in `createFetchWithBackoff` and
`createFetchWithConsumedMessages`, plus regression test
`should ignore successful responses that arrive after a paused request was aborted`
in `test/stream.test.ts`.

## Operational Diagnostics

Client-side diagnostics controls that exist to make field failures observable
without changing the state machine's behavior.

### D0: Diagnostics are observational only

Verbose diagnostics may be enabled at stream construction time via client-side
storage, for example:

- `localStorage.setItem('electric.debug', 'true')`
- `localStorage.setItem('debug', 'electric*')`

When enabled, the client may emit detailed request/response/state logs, but
those diagnostics must not alter fetch sequencing, state transitions, retry
eligibility, or message delivery semantics.

**Enforcement**: diagnostics are implemented as logging-only hooks in
`client.ts`, and the request/state behavior remains covered by the existing
state-machine tests.

## Invariants

Properties that must hold after every state transition. Checked automatically by
`assertStateInvariants()` and `assertReachableInvariants()` in the DSL.

### I0: Kind/instanceof consistency

`state.kind` and `state instanceof XxxState` must always agree. The mapping is
1:1: `initial` ↔ InitialState, `syncing` ↔ SyncingState, etc.

**Enforcement**: `KIND_TO_CLASS` map + `toBeInstanceOf` check in `assertStateInvariants`.

### I1: isUpToDate iff LiveState in delegation chain

`state.isUpToDate === true` only when LiveState is the state itself, or is reachable
via the `previousState` delegation chain of PausedState or ErrorState.

**Enforcement**: Runtime check in `assertStateInvariants`.

### I2: Immutability

Transitions always create new state objects; they never mutate existing ones.
Exception: no-op transitions return `this` (reference-equal).

**Enforcement**: The truth table tests `sameReference` expectations. All state fields
are `readonly`.

### I3: Pause/resume round-trip

For non-PausedState input: `state.pause().resume() === state` (reference equality).

For PausedState input: `paused.pause()` is idempotent (returns `this` by I8), so
`paused.pause().resume()` returns `paused.previousState`, not `paused`. Handle and
offset are still preserved through the round-trip for all states.

**Enforcement**: Algebraic property test across all 7 states (`state.pause().resume() === state`).
`assertReachableInvariants` verifies the pause/resume round-trip holds on every transition
recorded by the DSL scenario builder.

### I4: Error/retry preserves identity

`state.toErrorState(err).retry() === state` (reference equality).

Special case: when `state` is already an ErrorState, the constructor unwraps same-type
nesting (I12), so `errorState.toErrorState(newErr).retry()` returns
`errorState.previousState` (the inner state), not `errorState` itself.

**Enforcement**: Algebraic property test across all 7 states.

### I5: LiveState has lastSyncedAt

After transitioning TO LiveState from a non-Live state, `lastSyncedAt` is defined.

**Enforcement**: `assertReachableInvariants` checks this on every transition.

### I6: StaleRetryState tracking

When `state.kind === 'stale-retry'`:

- `staleCacheBuster` is defined (non-undefined)
- `staleCacheRetryCount > 0`

**Enforcement**: Runtime check in `assertStateInvariants`.

### I7: ReplayingState has cursor

When `state.kind === 'replaying'`: `replayCursor` is defined.

**Enforcement**: Runtime check in `assertStateInvariants`.

### I8: PausedState delegation

PausedState delegates ALL field getters to `previousState`:

- `handle`, `offset`, `schema`, `liveCacheBuster`, `lastSyncedAt`
- `isUpToDate`, `staleCacheBuster`, `staleCacheRetryCount`
- `sseFallbackToLongPolling`, `consecutiveShortSseConnections`, `replayCursor`
- `applyUrlParams` (URL params match inner state)

Additionally: `PausedState.pause()` is idempotent (returns `this`).

**Enforcement**: Field-by-field equality checks in `assertStateInvariants`.
Idempotence checked in algebraic property tests.

### I9: ErrorState delegation

ErrorState delegates ALL field getters to `previousState` (same list as I8 minus
`pause()` idempotence). Additionally:

- `isUpToDate` delegates to `previousState`
- `error` is always defined and instanceof Error
- `applyUrlParams` delegates to `previousState`

**Enforcement**: Field-by-field equality checks in `assertStateInvariants`.

### I10: markMustRefetch always resets

For any state, `state.markMustRefetch(handle)` produces an InitialState with:

- `offset === '-1'`
- `handle === handle` (the argument)
- `lastSyncedAt` preserved from previous state
- `schema === undefined`
- `liveCacheBuster === ''`

**Enforcement**: Algebraic property test across all 7 states; dedicated test
(`markMustRefetch resets to InitialState with correct defaults`).

### I11: withHandle preserves everything except handle

`state.withHandle(h)` produces a state of the same kind where:

- `handle === h`
- `offset` unchanged
- All other fields unchanged

**Enforcement**: Algebraic property test across all 7 states.

### I12: No same-type nesting of delegating states

`PausedState.previousState` is never a `PausedState`. `ErrorState.previousState` is
never an `ErrorState`. The constructors unwrap same-type nesting automatically:

- `Paused(Paused(X))` → `Paused(X)`
- `Error(Error(X))` → `Error(X)` (newer error replaces older)

Cross-type nesting (`Paused(Error(X))`, `Error(Paused(X))`) is preserved — it's
semantically meaningful. Alternating types can still produce chains longer than 2
(e.g. `Paused(Error(Paused(X)))`); the guard prevents only same-type stacking.

**Enforcement**: Runtime check in `assertStateInvariants` + dedicated algebraic test.

## Constraints

Things that must NOT happen.

### C1: StaleRetryState must not enter replay mode

`StaleRetryState.canEnterReplayMode()` returns `false`. Entering replay would
lose the stale cache retry count. The caller (`client.ts`) checks this before
calling `enterReplayMode()`.

**Enforcement**: Explicit test (`canEnterReplayMode returns false`).

### C2: LiveState enterReplayMode returns this

`LiveState.enterReplayMode()` returns `this` (base class default). Already
up-to-date; replay is meaningless.

**Enforcement**: Truth table entry (sameReference no-op).

### C3: Error ignores response/messages; Paused ignores messages/SSE close

- ErrorState:
  `handleResponseMetadata` returns `{ action: 'ignored', state: this }`
  and `handleMessageBatch` returns `{ state: this, suppressBatch: false, becameUpToDate: false }`
- PausedState:
  `handleMessageBatch` and `handleSseConnectionClosed` are no-ops
  and `handleResponseMetadata` delegates to `previousState`, preserving the paused wrapper for `accepted` and `stale-retry` transitions (`ignored` returns `this`)

**Enforcement**: Truth table entries (`error + response/messages` and `paused + response/messages/sseClose`).

### C4: Schema adoption is first-write-wins

`schema = this.schema ?? input.responseSchema` — once a schema is set, subsequent
responses cannot overwrite it.

**Enforcement**: Dedicated tests (`response adopts schema when state has none`,
`response does not overwrite existing schema`).

### C5: 204 vs 200 lastSyncedAt semantics

- 204 response: `lastSyncedAt` is set to `input.now` immediately
- 200 response: `lastSyncedAt` is NOT updated (deferred to `handleMessageBatch`)

**Enforcement**: Dedicated tests (`204 response sets lastSyncedAt`,
`200 response does not set lastSyncedAt`).

### C6: SSE offset update rules

- SSE up-to-date messages update offset via `upToDateOffset`
- Non-SSE up-to-date messages preserve existing offset

**Enforcement**: Dedicated tests (`SSE up-to-date message updates offset`,
`non-SSE up-to-date message preserves existing offset`).

### C7: Stale response always enters stale-retry

When a stale response arrives (responseHandle === expiredHandle), the state always
enters `stale-retry` regardless of whether the state has a valid local handle.
The `currentFields` (including any valid local handle) are preserved in the new
`StaleRetryState`, and a cache buster is added to ensure the retry URL is unique.

**Enforcement**: Dedicated stale-handle tests.

### C8: SSE state is private to LiveState

`sseFallbackToLongPolling` and `consecutiveShortSseConnections` are private fields
on `LiveState`, not carried in `SharedStateFields`. LiveState preserves SSE state
through its own self-transitions (`handleResponseMetadata`, `onUpToDate`,
`handleSseConnectionClosed`, `withHandle`) via a private `sseState` accessor.
Other states don't carry SSE state — when transitioning from a non-Live state
back to Live, SSE state resets to defaults.

**Enforcement**: Dedicated test (`SSE state is preserved through LiveState self-transitions`).

### C9: Aborted requests must not emit state-machine events

The state machine may ignore `response/messages/sseClose` while in `ErrorState`
or `PausedState` (C3), but aborted requests must not rely on that behavior for
correctness. A request aborted by pause/resume, system wake, visibility change,
or explicit refresh is part of an old request generation and must be discarded
before it can emit a late `response` event.

Without this constraint, a late success from an aborted request can be processed
after a newer request has already failed and moved the stream into `ErrorState`,
producing `"Response was ignored by state \"error\""` warnings and silently
dropping fresh data until another restart.

**Enforcement**: Dedicated regression test
(`should ignore successful responses that arrive after a paused request was aborted`)
plus runtime abort checks in the fetch wrapper chain.

## Shape notification semantics

The `Shape` class (`shape.ts`) wraps a `ShapeStream` and notifies subscribers
when the materialised `rows` change. These invariants define _when_ `#notify`
fires. They are separate from the ShapeStream state machine above; the stream
delivers every message, but the Shape decides when the resulting view is
consistent enough to surface to subscribers.

### N1: No notify before first up-to-date

Data messages (insert/update/delete) that arrive while `Shape.#status ===
'syncing'` apply to `#data` but do NOT call `#notify`. The first subscriber
notification fires when the shape transitions from `syncing` to `up-to-date`
via an `up-to-date` control message.

**Rationale**: the sync-service may send a response without an up-to-date
control message (e.g. the initial response for `offset === -1`, see
`api.ex:determine_up_to_date`). If the Shape notified subscribers on those
inserts, subscribers would observe a partial view AND the stream's
`lastSyncedAt()` would still be `undefined` (stream.ts `handleMessageBatch`
only writes `lastSyncedAt` when the batch contains an up-to-date). N1 ties
subscriber-visible snapshots to the stream-level "we've caught up" signal.

**Enforcement**: `Shape#process notification PBT > regression: subscriber
must not see undefined lastSyncedAt during initial sync with real
ShapeStream` in `test/pbt-micro.test.ts` and the broader PBT there.

### N2: Notify on change while up-to-date

Once `#status === 'up-to-date'`, any data message triggers a notification,
and the status then transitions back to `syncing` until the next up-to-date.
This is the mechanism that delivers the `[up-to-date, insert]`-in-one-batch
case (the insert runs after the up-to-date message has set status to
up-to-date, so the insert sees `wasUpToDate === true` and calls `#notify`).

**Enforcement**: `Shape#process notification PBT > deterministic:
[up-to-date, insert] — subscriber's last view must match shape` and the
broader PBT.

A `must-refetch` control message clears `#data` and `#insertedKeys` and
transitions `#status` back to `syncing`, which re-engages N1: subscribers
receive the post-rotation state on the next `up-to-date` without ever
observing an intermediate empty-rows notification. The
`should resync from scratch on a shape rotation` integration test in
`test/client.test.ts` pins this behavior.

## Bidirectional Enforcement Checklist

### Doc -> Code: Is each invariant enforced?

| Invariant | Types    | assertStateInvariants | assertReachableInvariants | Algebraic         | Truth Table         | Dedicated Test |
| --------- | -------- | --------------------- | ------------------------- | ----------------- | ------------------- | -------------- |
| I0        | -        | yes                   | -                         | -                 | -                   | -              |
| I1        | -        | yes                   | -                         | -                 | -                   | -              |
| I2        | readonly | -                     | -                         | -                 | yes (sameReference) | -              |
| I3        | -        | -                     | yes                       | yes               | -                   | -              |
| I4        | -        | -                     | -                         | yes               | -                   | -              |
| I5        | -        | -                     | yes                       | -                 | -                   | -              |
| I6        | -        | yes                   | -                         | -                 | -                   | -              |
| I7        | -        | yes                   | -                         | -                 | -                   | -              |
| I8        | -        | yes                   | -                         | yes (idempotence) | -                   | -              |
| I9        | -        | yes                   | -                         | -                 | -                   | -              |
| I10       | -        | -                     | -                         | yes               | -                   | yes            |
| I11       | -        | -                     | -                         | yes               | -                   | -              |
| I12       | -        | yes                   | -                         | yes               | -                   | yes            |

| Constraint | Types | Truth Table | Dedicated Test |
| ---------- | ----- | ----------- | -------------- |
| C1         | -     | -           | yes            |
| C2         | -     | yes         | yes            |
| C3         | -     | yes         | -              |
| C4         | -     | -           | yes            |
| C5         | -     | -           | yes            |
| C6         | -     | -           | yes            |
| C7         | -     | yes         | yes            |
| C8         | -     | -           | yes            |
| C9         | -     | -           | yes            |

### Code -> Doc: Is each test derived from the spec?

| Test File / Section            | Spec Reference          |
| ------------------------------ | ----------------------- |
| Tier 1: scenario builder tests | I0-I11 (via auto-check) |
| Tier 2: transition truth table | All 70 cells            |
| Algebraic property tests       | I3, I4, I10, I11, I8    |
| Fuzz testing                   | I0-I12 (all invariants) |
| Mutation testing               | I0-I12 (robustness)     |
| shouldUseSse guard tests       | LiveState SSE behavior  |
| SSE connection closed tests    | LiveState SSE fallback  |
| applyUrlParams tests           | URL construction        |
| Schema adoption tests          | C4                      |
| 204/200 lastSyncedAt tests     | C5                      |
| SSE offset tests               | C6                      |
| Stale handle tests             | C7                      |
| ReplayingState suppress tests  | Replay cursor semantics |

### Gaps

| Gap                            | Status | Notes                                         |
| ------------------------------ | ------ | --------------------------------------------- |
| SSE fallback to long polling   | Tested | Direct construction only (DSL doesn't expose) |
| ReplayingState suppressBatch   | Tested | Direct construction only (DSL doesn't expose) |
| ErrorState.reset()             | Tested | Direct construction (DSL doesn't have reset)  |
| handleMessageBatch no-messages | Tested | Direct construction (edge case)               |

## Client Fetch Loop Paths

Exhaustive enumeration of every code path in `client.ts` that loops back to make
another HTTP request. Each path must change the URL to avoid infinite loops.

### Invariant: loop-back URL progression

Any loop-back path that would otherwise resend a stuck non-live request must
change the next request URL via state advancement or an explicit cache buster.
This is enforced by the path-specific guards listed below. Live requests
(`live=true`) legitimately reuse URLs.

### Invariant: aborted-request quarantine

Any request generation that has been aborted must terminate as an abort before
it can feed metadata or messages into the state machine. This guard sits below
the state machine itself: it preserves the assumption that every delivered
`response/messages/sseClose` event belongs to the currently active request
generation.

### Invariant: unconditional 409 cache buster

Every code path that handles a 409 response must unconditionally call
`createCacheBuster()` before retrying. This ensures unique retry URLs regardless
of whether the server returns a new handle, the same handle, or no handle. The
cache buster is stripped by `canonicalShapeKey` so it doesn't affect shape
identity or caching logic — it only affects the raw URL sent to the server/CDN.

**Enforcement**:

- Static analysis rule `conditional-409-cache-buster` in `shape-stream-static-analysis.mjs` — covers both L4 and L6 code paths at source level.
- L4 (main stream `#requestShape` 409 path): model-based property test commands `Respond409SameHandleCmd` and `Respond409NoHandleCmd` in `test/model-based.test.ts`.
- L6 (`fetchSnapshotWithRetry` 409 path): property tests in `test/pbt-micro.test.ts > Shape #fetchSnapshotWithRetry 409 loop PBT` — asserts every retry URL carries a unique `cache-buster` param across 409-new, 409-same, and 409-no-handle sequences, and that `#maxSnapshotRetries = 5` is strictly upheld.

### Loop-back sites

Six sites in `client.ts` recurse or loop to issue a new fetch:

| #   | Site                                    | Line | Trigger                                                    | URL changes because                                                                                               | Guard                                                                        |
| --- | --------------------------------------- | ---- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| L1  | `#requestShape` → `#requestShape`       | 939  | Normal completion after `#fetchShape()`                    | Offset advances from response headers                                                                             | `#checkFastLoop` (non-live)                                                  |
| L2  | `#requestShape` catch → `#requestShape` | 883  | Abort with `FORCE_DISCONNECT_AND_REFRESH` or `SYSTEM_WAKE` | `isRefreshing` flag changes `canLongPoll`, affecting `live` param                                                 | Abort signals are discrete events                                            |
| L3  | `#requestShape` catch → `#requestShape` | 895  | `StaleCacheError` thrown by `#onInitialResponse`           | `StaleRetryState` adds `cache_buster` param; after max retries, self-healing clears expired entry + resets stream | `maxStaleCacheRetries` counter + `#expiredShapeRecoveryKey` (once per shape) |
| L4  | `#requestShape` catch → `#requestShape` | 923  | HTTP 409 (shape rotation)                                  | `#reset()` sets offset=-1 + new handle; unconditional cache buster on every 409                                   | New handle + unique retry URL via cache buster                               |
| L5  | `#start` catch → `#start`               | 775  | Exception + `onError` returns retry opts                   | Params/headers merged from `retryOpts`                                                                            | `#maxConsecutiveErrorRetries` (50)                                           |
| L6  | `fetchSnapshot` catch → `fetchSnapshot` | 1937 | HTTP 409 on snapshot fetch                                 | New handle via `withHandle()`; unconditional cache buster on every 409                                            | `#maxSnapshotRetries` (5) + unconditional cache buster                       |

### Guard mechanisms

| Guard                         | Scope                         | How it works                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#checkFastLoop`              | Non-live `#requestShape` only | Detects N requests at same offset within a time window. First: clears caches + resets. Persistent: exponential backoff → throws FetchError(502).                                                                 |
| `maxStaleCacheRetries`        | Stale response path (L3)      | State machine counts stale retries. After 3 consecutive stale responses, clears expired entry and attempts one self-healing retry. Throws FetchError(502) if self-healing also fails.                            |
| `#expiredShapeRecoveryKey`    | Self-healing (L3 extension)   | Records shape key after first self-healing attempt. Second exhaustion on same key skips self-healing → FetchError(502). Cleared on up-to-date.                                                                   |
| `#maxSnapshotRetries`         | Snapshot 409 path (L6)        | Counts consecutive snapshot 409s. Unconditional cache buster on every retry. Throws FetchError(502) after 5. Runtime-enforced by `Shape #fetchSnapshotWithRetry 409 loop PBT` in `test/pbt-micro.test.ts`.       |
| `#maxConsecutiveErrorRetries` | `#start` onError retry (L5)   | Counts consecutive error retries. Sends error to subscribers and tears down after 50. Reset on successful message batch.                                                                                         |
| Abort-aware fetch wrappers    | All request paths             | `createFetchWithBackoff` and `createFetchWithConsumedMessages` re-check `signal.aborted` after fetch resolution and after body consumption, converting late successes into aborts before state-machine delivery. |
| Pause lock                    | `#requestShape` entry         | Returns immediately if paused. Prevents fetches during snapshots.                                                                                                                                                |
| Up-to-date exit               | `#requestShape` entry         | Returns if `!subscribe` and `isUpToDate`. Breaks loop for one-shot syncs.                                                                                                                                        |

### Coverage gaps

| Gap                   | Risk | Notes                                                                              |
| --------------------- | ---- | ---------------------------------------------------------------------------------- |
| Live polling same URL | None | Intentionally allowed — server long-polls, cursor may not change between responses |
