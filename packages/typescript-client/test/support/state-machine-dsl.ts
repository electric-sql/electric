import { expect } from 'vitest'
import {
  ShapeStreamState,
  ShapeStreamStateKind,
  createInitialState,
  InitialState,
  SyncingState,
  LiveState,
  ReplayingState,
  StaleRetryState,
  PausedState,
  ErrorState,
  SharedStateFields,
  ResponseMetadataInput,
  ResponseMetadataTransition,
  MessageBatchInput,
  MessageBatchTransition,
  SseCloseInput,
  SseCloseTransition,
} from '../../src/shape-stream-state'
import type { Offset } from '../../src/types'

// ─── Factory helpers (mirror those in shape-stream-state.test.ts) ───

export function makeShared(
  overrides?: Partial<SharedStateFields>
): SharedStateFields {
  return {
    handle: `h1`,
    offset: `0_0`,
    schema: {},
    liveCacheBuster: `cursor-1`,
    lastSyncedAt: undefined,
    ...overrides,
  }
}

export function makeResponseInput(
  overrides?: Partial<ResponseMetadataInput>
): ResponseMetadataInput {
  return {
    status: 200,
    responseHandle: `h1`,
    responseOffset: `0_0`,
    responseCursor: `cursor-1`,
    expiredHandle: undefined,
    now: Date.now(),
    maxStaleCacheRetries: 3,
    createCacheBuster: () => `cb-1`,
    ...overrides,
  }
}

export function makeMessageBatchInput(
  overrides?: Partial<MessageBatchInput>
): MessageBatchInput {
  return {
    hasMessages: true,
    hasUpToDateMessage: true,
    isSse: false,
    upToDateOffset: undefined,
    now: Date.now(),
    currentCursor: `cursor-1`,
    ...overrides,
  }
}

// ─── EventSpec: discriminated union of all event types ───

export type EventSpec =
  | { type: `response`; input: Partial<ResponseMetadataInput> }
  | { type: `messages`; input: Partial<MessageBatchInput> }
  | { type: `sseClose`; input: SseCloseInput }
  | { type: `pause` }
  | { type: `resume` }
  | { type: `error`; error: Error }
  | { type: `retry` }
  | { type: `markMustRefetch`; handle?: string }
  | { type: `withHandle`; handle: string }
  | { type: `enterReplayMode`; cursor: string }

// ─── Event result types ───

export interface EventResult {
  event: EventSpec
  prevState: ShapeStreamState
  state: ShapeStreamState
  transition?:
    | ResponseMetadataTransition
    | MessageBatchTransition
    | SseCloseTransition
}

// ─── Invariant Checkers ───

export function assertStateInvariants(state: ShapeStreamState): void {
  // I1: isUpToDate === true only when LiveState is in the delegation chain
  if (state.isUpToDate) {
    if (state instanceof PausedState) {
      expect(state.previousState.isUpToDate).toBe(true)
    } else if (state instanceof ErrorState) {
      expect(state.previousState.isUpToDate).toBe(true)
    } else {
      expect(state).toBeInstanceOf(LiveState)
    }
  }

  // I2: PausedState.pause() is idempotent
  if (state instanceof PausedState) {
    expect(state.pause()).toBe(state)
  }

  // I6: StaleRetryState always has staleCacheBuster and count > 0
  if (state.kind === `stale-retry`) {
    expect(state.staleCacheBuster).toBeDefined()
    expect(state.staleCacheRetryCount).toBeGreaterThan(0)
  }

  // I7: ErrorState always has error
  if (state instanceof ErrorState) {
    expect(state.error).toBeDefined()
    expect(state.error).toBeInstanceOf(Error)
  }

  // I8: ReplayingState always has replayCursor
  if (state.kind === `replaying`) {
    expect(state.replayCursor).toBeDefined()
  }

  // Delegation invariants: PausedState delegates all field getters
  if (state instanceof PausedState) {
    expect(state.handle).toBe(state.previousState.handle)
    expect(state.offset).toBe(state.previousState.offset)
    expect(state.liveCacheBuster).toBe(state.previousState.liveCacheBuster)
    expect(state.lastSyncedAt).toBe(state.previousState.lastSyncedAt)
    expect(state.isUpToDate).toBe(state.previousState.isUpToDate)
  }

  // Delegation invariants: ErrorState delegates all field getters
  if (state instanceof ErrorState) {
    expect(state.handle).toBe(state.previousState.handle)
    expect(state.offset).toBe(state.previousState.offset)
    expect(state.liveCacheBuster).toBe(state.previousState.liveCacheBuster)
    expect(state.lastSyncedAt).toBe(state.previousState.lastSyncedAt)
    expect(state.isUpToDate).toBe(state.previousState.isUpToDate)
  }
}

export function assertReachableInvariants(
  event: EventSpec,
  prevState: ShapeStreamState,
  nextState: ShapeStreamState
): void {
  // I5 (reachable): After transitioning TO LiveState, lastSyncedAt is defined
  if (nextState.kind === `live` && prevState.kind !== `live`) {
    expect(nextState.lastSyncedAt).toBeDefined()
  }

  // I3: pause()->resume() preserves handle and offset
  if (event.type === `resume`) {
    expect(nextState.handle).toBe(prevState.handle)
    expect(nextState.offset).toBe(prevState.offset)
  }

  // I4: error()->retry() restores previousState by reference
  if (event.type === `retry` && prevState instanceof ErrorState) {
    expect(nextState).toBe(prevState.previousState)
  }

  // I9: markMustRefetch always produces InitialState with offset '-1'
  if (event.type === `markMustRefetch`) {
    expect(nextState).toBeInstanceOf(InitialState)
    expect(nextState.offset).toBe(`-1`)
  }
}

// ─── applyEvent: applies a single event to a state ───

export function applyEvent(
  state: ShapeStreamState,
  event: EventSpec
): EventResult {
  const prevState = state
  let nextState: ShapeStreamState
  let transition:
    | ResponseMetadataTransition
    | MessageBatchTransition
    | SseCloseTransition
    | undefined

  switch (event.type) {
    case `response`: {
      const t = state.handleResponseMetadata(makeResponseInput(event.input))
      transition = t
      nextState = t.state
      break
    }
    case `messages`: {
      const t = state.handleMessageBatch(makeMessageBatchInput(event.input))
      transition = t
      nextState = t.state
      break
    }
    case `sseClose`: {
      const t = state.handleSseConnectionClosed(event.input)
      transition = t
      nextState = t.state
      break
    }
    case `pause`:
      nextState = state.pause()
      break
    case `resume`:
      if (state instanceof PausedState) {
        nextState = state.resume()
      } else {
        nextState = state
      }
      break
    case `error`:
      nextState = state.toErrorState(event.error)
      break
    case `retry`:
      if (state instanceof ErrorState) {
        nextState = state.retry()
      } else {
        nextState = state
      }
      break
    case `markMustRefetch`:
      nextState = state.markMustRefetch(event.handle)
      break
    case `withHandle`:
      nextState = state.withHandle(event.handle)
      break
    case `enterReplayMode`:
      nextState = state.canEnterReplayMode()
        ? state.enterReplayMode(event.cursor)
        : state
      break
  }

  return { event, prevState, state: nextState, transition }
}

// ─── Seeded PRNG (mulberry32) ───

export function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── pickRandomEvent: generates a random EventSpec ───

const EVENT_TYPES: EventSpec[`type`][] = [
  `response`,
  `messages`,
  `sseClose`,
  `pause`,
  `resume`,
  `error`,
  `retry`,
  `markMustRefetch`,
  `withHandle`,
  `enterReplayMode`,
]

export function pickRandomEvent(rng: () => number): EventSpec {
  const type = EVENT_TYPES[Math.floor(rng() * EVENT_TYPES.length)]

  switch (type) {
    case `response`:
      return {
        type: `response`,
        input: {
          responseHandle: `h-${Math.floor(rng() * 5)}`,
          responseOffset: `${Math.floor(rng() * 100)}_${Math.floor(rng() * 10)}`,
          responseCursor: `cursor-${Math.floor(rng() * 5)}`,
          status: rng() > 0.9 ? 204 : 200,
          expiredHandle: rng() > 0.8 ? `h-${Math.floor(rng() * 5)}` : undefined,
        },
      }
    case `messages`:
      return {
        type: `messages`,
        input: {
          hasMessages: rng() > 0.2,
          hasUpToDateMessage: rng() > 0.4,
          isSse: rng() > 0.5,
          upToDateOffset:
            rng() > 0.5 ? `${Math.floor(rng() * 100)}_0` : undefined,
          currentCursor: `cursor-${Math.floor(rng() * 5)}`,
        },
      }
    case `sseClose`:
      return {
        type: `sseClose`,
        input: {
          connectionDuration: Math.floor(rng() * 10000),
          wasAborted: rng() > 0.7,
          minConnectionDuration: 1000,
          maxShortConnections: 3,
        },
      }
    case `pause`:
      return { type: `pause` }
    case `resume`:
      return { type: `resume` }
    case `error`:
      return {
        type: `error`,
        error: new Error(`fuzz-error-${Math.floor(rng() * 100)}`),
      }
    case `retry`:
      return { type: `retry` }
    case `markMustRefetch`:
      return {
        type: `markMustRefetch`,
        handle: rng() > 0.5 ? `h-${Math.floor(rng() * 5)}` : undefined,
      }
    case `withHandle`:
      return { type: `withHandle`, handle: `h-${Math.floor(rng() * 5)}` }
    case `enterReplayMode`:
      return {
        type: `enterReplayMode`,
        cursor: `cursor-${Math.floor(rng() * 5)}`,
      }
  }
}

// ─── ScenarioBuilder (Tier 1) ───

export interface TraceEntry {
  event: EventSpec
  prevState: ShapeStreamState
  state: ShapeStreamState
  transition?:
    | ResponseMetadataTransition
    | MessageBatchTransition
    | SseCloseTransition
}

export class ScenarioBuilder<K extends ShapeStreamStateKind = `initial`> {
  readonly #state: ShapeStreamState
  readonly #trace: TraceEntry[]

  constructor(state: ShapeStreamState, trace: TraceEntry[] = []) {
    this.#state = state
    this.#trace = trace
  }

  // ─── Internal step helper ───

  #step(event: EventSpec): ScenarioBuilder<ShapeStreamStateKind> {
    const result = applyEvent(this.#state, event)
    assertStateInvariants(result.state)
    assertReachableInvariants(event, result.prevState, result.state)
    const entry: TraceEntry = {
      event,
      prevState: result.prevState,
      state: result.state,
      transition: result.transition,
    }
    return new ScenarioBuilder(result.state, [...this.#trace, entry])
  }

  // ─── Event handlers (return unknown kind — determined at runtime) ───

  response(
    input?: Partial<ResponseMetadataInput>
  ): ScenarioBuilder<ShapeStreamStateKind> {
    return this.#step({ type: `response`, input: input ?? {} })
  }

  messages(
    input?: Partial<MessageBatchInput>
  ): ScenarioBuilder<ShapeStreamStateKind> {
    return this.#step({ type: `messages`, input: input ?? {} })
  }

  sseClose(input: SseCloseInput): ScenarioBuilder<ShapeStreamStateKind> {
    return this.#step({ type: `sseClose`, input })
  }

  enterReplayMode(cursor: string): ScenarioBuilder<ShapeStreamStateKind> {
    return this.#step({ type: `enterReplayMode`, cursor })
  }

  // ─── Universal transitions ───

  pause(): ScenarioBuilder<`paused`> {
    return this.#step({ type: `pause` }) as ScenarioBuilder<`paused`>
  }

  error(err: Error): ScenarioBuilder<`error`> {
    return this.#step({ type: `error`, error: err }) as ScenarioBuilder<`error`>
  }

  markMustRefetch(handle?: string): ScenarioBuilder<`initial`> {
    return this.#step({
      type: `markMustRefetch`,
      handle,
    }) as ScenarioBuilder<`initial`>
  }

  withHandle(handle: string): ScenarioBuilder<K> {
    return this.#step({ type: `withHandle`, handle }) as ScenarioBuilder<K>
  }

  // ─── State-specific transitions ───

  resume(
    this: ScenarioBuilder<`paused`>
  ): ScenarioBuilder<ShapeStreamStateKind> {
    return this.#step({ type: `resume` })
  }

  retry(this: ScenarioBuilder<`error`>): ScenarioBuilder<ShapeStreamStateKind> {
    return this.#step({ type: `retry` })
  }

  // ─── Assertions ───

  expectKind<T extends ShapeStreamStateKind>(kind: T): ScenarioBuilder<T> {
    expect(this.#state.kind).toBe(kind)
    return this as unknown as ScenarioBuilder<T>
  }

  expectHandle(handle: string | undefined): ScenarioBuilder<K> {
    expect(this.#state.handle).toBe(handle)
    return this
  }

  expectOffset(offset: string): ScenarioBuilder<K> {
    expect(this.#state.offset).toBe(offset)
    return this
  }

  expectUpToDate(expected: boolean): ScenarioBuilder<K> {
    expect(this.#state.isUpToDate).toBe(expected)
    return this
  }

  expectAction(
    action: `accepted` | `ignored` | `stale-retry`
  ): ScenarioBuilder<K> {
    const lastEntry = this.#trace[this.#trace.length - 1]
    expect(lastEntry).toBeDefined()
    expect((lastEntry.transition as ResponseMetadataTransition)?.action).toBe(
      action
    )
    return this
  }

  // ─── Terminal ───

  done(): { state: ShapeStreamState; trace: TraceEntry[] } {
    return { state: this.#state, trace: [...this.#trace] }
  }

  get currentState(): ShapeStreamState {
    return this.#state
  }
}

// ─── scenario() factory ───

export function scenario(opts?: {
  offset?: Offset
  handle?: string
}): ScenarioBuilder<`initial`> {
  const initial = createInitialState({
    offset: opts?.offset ?? `-1`,
    handle: opts?.handle,
  })
  return new ScenarioBuilder<`initial`>(initial)
}

// ─── rawEvents (Tier 2) ───

export function rawEvents(
  startState: ShapeStreamState,
  events: EventSpec[]
): EventResult[] {
  const results: EventResult[] = []
  let current = startState

  for (const event of events) {
    const result = applyEvent(current, event)
    assertStateInvariants(result.state)
    results.push(result)
    current = result.state
  }

  return results
}

// ─── makeAllStates: one representative of each kind ───

export function makeAllStates(): Array<{
  kind: ShapeStreamStateKind
  state: ShapeStreamState
}> {
  const shared = makeShared({ lastSyncedAt: 1000 })
  return [
    { kind: `initial`, state: createInitialState({ offset: `-1` }) },
    { kind: `syncing`, state: new SyncingState(shared) },
    {
      kind: `live`,
      state: new LiveState(shared),
    },
    {
      kind: `replaying`,
      state: new ReplayingState({ ...shared, replayCursor: `cursor-1` }),
    },
    {
      kind: `stale-retry`,
      state: new StaleRetryState({
        ...shared,
        staleCacheBuster: `cb-1`,
        staleCacheRetryCount: 1,
      }),
    },
    {
      kind: `paused`,
      state: new PausedState(new SyncingState(shared)),
    },
    {
      kind: `error`,
      state: new ErrorState(new SyncingState(shared), new Error(`test-error`)),
    },
  ]
}

// ─── Counterexample shrinking ───

export function replayEvents(events: EventSpec[]): ShapeStreamState {
  let state: ShapeStreamState = createInitialState({ offset: `-1` })
  for (const event of events) {
    const result = applyEvent(state, event)
    assertStateInvariants(result.state)
    assertReachableInvariants(event, result.prevState, result.state)
    state = result.state
  }
  return state
}

export function shrinkFailingSequence(
  events: EventSpec[],
  stillFails: (events: EventSpec[]) => boolean
): EventSpec[] {
  let current = [...events]
  for (let i = current.length - 1; i >= 0; i--) {
    const without = [...current.slice(0, i), ...current.slice(i + 1)]
    if (stillFails(without)) {
      current = without
    }
  }
  return current
}

// ─── Event mutation helpers ───

export function duplicateEvent(trace: EventSpec[], index: number): EventSpec[] {
  return [...trace.slice(0, index), trace[index], ...trace.slice(index)]
}

export function reorderEvents(
  trace: EventSpec[],
  i: number,
  j: number
): EventSpec[] {
  const result = [...trace]
  ;[result[i], result[j]] = [result[j], result[i]]
  return result
}

export function dropEvent(trace: EventSpec[], index: number): EventSpec[] {
  return [...trace.slice(0, index), ...trace.slice(index + 1)]
}

// ─── Standard scenarios catalog ───

export const standardScenarios = {
  'happy-path-live': () =>
    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .messages({ hasUpToDateMessage: true })
      .expectKind(`live`),

  'stale-retry': () =>
    scenario()
      .response({
        responseHandle: `stale-h`,
        expiredHandle: `stale-h`,
      })
      .expectAction(`stale-retry`),

  'pause-resume': () =>
    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .pause()
      .expectKind(`paused`)
      .resume()
      .expectKind(`syncing`),

  'error-retry': () =>
    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .error(new Error(`boom`))
      .expectKind(`error`)
      .retry()
      .expectKind(`syncing`),

  'full-lifecycle': () =>
    scenario()
      .response({ responseHandle: `h1` })
      .messages({ hasUpToDateMessage: true })
      .expectKind(`live`)
      .error(new Error(`disconnect`))
      .expectKind(`error`)
      .retry()
      .expectKind(`live`)
      .pause()
      .expectKind(`paused`)
      .resume()
      .expectKind(`live`),
} as const
