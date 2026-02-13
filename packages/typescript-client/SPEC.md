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
- `enterReplayMode` returns `this` when `canEnterReplayMode()` is false
- `pause` on PausedState returns `this` (idempotent)
- `response`/`messages`/`sseClose` on Paused or Error return `this` (ignored)

## Invariants

Properties that must hold after every state transition. Checked automatically by
`assertStateInvariants()` and `assertReachableInvariants()` in the DSL.

### I0: Kind/instanceof consistency

`state.kind` and `state instanceof XxxState` must always agree. The mapping is
1:1: `initial` ↔ InitialState, `syncing` ↔ SyncingState, etc.

**Enforcement**: `KIND_TO_CLASS` map + `toBeInstanceOf` check in `assertStateInvariants`.

### I1: isUpToDate iff LiveState in delegation chain

`state.isUpToDate === true` only when LiveState is the state itself, or is reachable
via `previousState` delegation (i.e., PausedState or ErrorState wrapping LiveState).

**Enforcement**: Runtime check in `assertStateInvariants`.

### I2: Immutability

Transitions always create new state objects; they never mutate existing ones.
Exception: no-op transitions return `this` (reference-equal).

**Enforcement**: The truth table tests `sameReference` expectations. All state fields
are `readonly`.

### I3: Pause/resume preserves identity

`state.pause().resume() === state` (reference equality). Handle and offset are
preserved through the round-trip.

**Enforcement**: Algebraic property test across all 7 states + `assertReachableInvariants`.

### I4: Error/retry preserves identity

`state.toErrorState(err).retry() === state` (reference equality).

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

**Enforcement**: Algebraic property test across all 7 states.

### I11: withHandle preserves everything except handle

`state.withHandle(h)` produces a state of the same kind where:

- `handle === h`
- `offset` unchanged
- All other fields unchanged

**Enforcement**: Algebraic property test across all 7 states.

## Constraints

Things that must NOT happen.

### C1: StaleRetryState cannot enter replay mode

`StaleRetryState.canEnterReplayMode()` returns false. Entering replay would lose
the stale cache retry count.

**Enforcement**: Explicit test + truth table entry (sameReference no-op).

### C2: LiveState cannot enter replay mode

`LiveState.canEnterReplayMode()` returns false. Already up-to-date; replay is
meaningless.

**Enforcement**: Truth table entry (sameReference no-op).

### C3: Paused/Error states ignore response and message events

`handleResponseMetadata` returns `{ action: 'ignored', state: this }`.
`handleMessageBatch` returns `{ state: this, suppressBatch: false, becameUpToDate: false }`.

**Enforcement**: Truth table entries with `sameReference: true`.

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

### C7: Stale response with valid local handle is ignored

When a stale response arrives but the state already has a different valid handle,
the response is ignored (action: `ignored`, state unchanged).

**Enforcement**: Truth table + dedicated stale-handle tests.

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
| I10       | -        | -                     | -                         | yes               | -                   | -              |
| I11       | -        | -                     | -                         | yes               | -                   | -              |

| Constraint | Types | Truth Table | Dedicated Test |
| ---------- | ----- | ----------- | -------------- |
| C1         | -     | yes         | yes            |
| C2         | -     | yes         | yes            |
| C3         | -     | yes         | -              |
| C4         | -     | -           | yes            |
| C5         | -     | -           | yes            |
| C6         | -     | -           | yes            |
| C7         | -     | yes         | yes            |

### Code -> Doc: Is each test derived from the spec?

| Test File / Section            | Spec Reference          |
| ------------------------------ | ----------------------- |
| Tier 1: scenario builder tests | I0-I11 (via auto-check) |
| Tier 2: transition truth table | All 70 cells            |
| Algebraic property tests       | I3, I4, I10, I11, I8    |
| Fuzz testing                   | I0-I9 (all invariants)  |
| Mutation testing               | I0-I9 (robustness)      |
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
