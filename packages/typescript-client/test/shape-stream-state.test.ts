import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  ErrorState,
  InitialState,
  LiveState,
  PausedState,
  ReplayingState,
  UrlParamsContext,
  StaleRetryState,
  SyncingState,
  ShapeStreamState,
} from '../src/shape-stream-state'
import {
  scenario,
  makeAllStates,
  makeShared,
  makeResponseInput,
  makeMessageBatchInput,
  applyEvent,
  assertStateInvariants,
  assertReachableInvariants,
  mulberry32,
  pickRandomEvent,
  replayEvents,
  shrinkFailingSequence,
  standardScenarios,
  duplicateEvent,
  reorderEvents,
  dropEvent,
  rawEvents,
} from './support/state-machine-dsl'
import type { EventSpec } from './support/state-machine-dsl'
import {
  TRANSITION_TABLE,
  type EventType,
} from './support/state-transition-table'
import {
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  CACHE_BUSTER_QUERY_PARAM,
} from '../src/constants'

describe(`shape stream state machine`, () => {
  // 1. InitialState → SyncingState on valid response
  it(`transitions InitialState → SyncingState on valid response`, () => {
    scenario()
      .response({ responseHandle: `new-handle` })
      .expectAction(`accepted`)
      .expectKind(`syncing`)
      .expectHandle(`new-handle`)
      .done()
  })

  // 2. InitialState → StaleRetryState on stale handle with no local handle
  it(`enters stale-retry state for stale handle when local handle is missing`, () => {
    const { state } = scenario()
      .response({
        responseHandle: `stale-handle`,
        expiredHandle: `stale-handle`,
      })
      .expectAction(`stale-retry`)
      .expectKind(`stale-retry`)
      .done()

    expect(state.staleCacheRetryCount).toBe(1)
    expect(state.staleCacheBuster).toBe(`cb-1`)
  })

  // 3. SyncingState ignores stale response when it has a valid handle
  it(`ignores stale response metadata when local handle exists`, () => {
    scenario({ handle: `good-handle` })
      .response({ responseHandle: `good-handle` })
      .expectKind(`syncing`)
      .expectHandle(`good-handle`)
      .response({
        responseHandle: `expired-handle`,
        responseOffset: `999_999`,
        responseCursor: `cursor-stale`,
        expiredHandle: `expired-handle`,
      })
      .expectAction(`ignored`)
      .expectKind(`syncing`)
      .expectHandle(`good-handle`)
      .done()
  })

  // 4. SyncingState → LiveState on up-to-date message
  it(`transitions SyncingState → LiveState on up-to-date message`, () => {
    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .messages({ hasUpToDateMessage: true })
      .expectKind(`live`)
      .expectUpToDate(true)
      .done()
  })

  // 5. LiveState stays LiveState on subsequent up-to-date
  it(`LiveState stays LiveState on subsequent up-to-date`, () => {
    scenario()
      .messages({ hasUpToDateMessage: true })
      .expectKind(`live`)
      .messages({ hasUpToDateMessage: true })
      .expectKind(`live`)
      .expectUpToDate(true)
      .done()
  })

  // 6. LiveState.isUpToDate returns true
  it(`LiveState.isUpToDate returns true`, () => {
    scenario().messages().expectKind(`live`).expectUpToDate(true).done()
  })

  // 7. InitialState/SyncingState.isUpToDate returns false
  it(`InitialState and SyncingState.isUpToDate return false`, () => {
    scenario().expectUpToDate(false).done()

    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .expectUpToDate(false)
      .done()
  })

  // 8. LiveState.shouldUseSse returns true when conditions met
  it(`LiveState.shouldUseSse returns true when conditions met`, () => {
    const { state } = scenario().messages().expectKind(`live`).done()

    expect(
      state.shouldUseSse({
        liveSseEnabled: true,
        isRefreshing: false,
        resumingFromPause: false,
      })
    ).toBe(true)
  })

  // 9. LiveState.shouldUseSse returns false when SSE disabled
  it(`LiveState.shouldUseSse returns false when SSE disabled`, () => {
    const { state } = scenario().messages().expectKind(`live`).done()

    expect(
      state.shouldUseSse({
        liveSseEnabled: false,
        isRefreshing: false,
        resumingFromPause: false,
      })
    ).toBe(false)
  })

  // 10. LiveState.handleSseConnectionClosed — healthy connection resets counter
  it(`LiveState resets counter on healthy SSE connection`, () => {
    const live = new LiveState(
      makeShared({ consecutiveShortSseConnections: 2 })
    )

    const transition = live.handleSseConnectionClosed({
      connectionDuration: 5000,
      wasAborted: false,
      minConnectionDuration: 1000,
      maxShortConnections: 3,
    })

    expect(transition.state).toBeInstanceOf(LiveState)
    expect(transition.state.consecutiveShortSseConnections).toBe(0)
    expect(transition.fellBackToLongPolling).toBe(false)
    expect(transition.wasShortConnection).toBe(false)
  })

  // 11. LiveState.handleSseConnectionClosed — short connection increments counter
  it(`LiveState increments counter on short SSE connection`, () => {
    const live = new LiveState(makeShared(), {
      consecutiveShortSseConnections: 1,
    })

    const transition = live.handleSseConnectionClosed({
      connectionDuration: 100,
      wasAborted: false,
      minConnectionDuration: 1000,
      maxShortConnections: 3,
    })

    expect(transition.state).toBeInstanceOf(LiveState)
    expect(transition.state.consecutiveShortSseConnections).toBe(2)
    expect(transition.fellBackToLongPolling).toBe(false)
    expect(transition.wasShortConnection).toBe(true)
  })

  // 12. LiveState.handleSseConnectionClosed — falls back to long polling after max short connections
  it(`LiveState falls back to long polling after max short connections`, () => {
    const live = new LiveState(makeShared(), {
      consecutiveShortSseConnections: 2,
    })

    const transition = live.handleSseConnectionClosed({
      connectionDuration: 100,
      wasAborted: false,
      minConnectionDuration: 1000,
      maxShortConnections: 3,
    })

    expect(transition.state).toBeInstanceOf(LiveState)
    expect(transition.state.consecutiveShortSseConnections).toBe(3)
    expect(transition.state.sseFallbackToLongPolling).toBe(true)
    expect(transition.fellBackToLongPolling).toBe(true)
  })

  // SSE state is preserved when LiveState transitions to itself
  it(`SSE state is preserved through LiveState self-transitions`, () => {
    const live = new LiveState(makeShared(), {
      consecutiveShortSseConnections: 2,
      sseFallbackToLongPolling: true,
    })

    // handleResponseMetadata creates new LiveState preserving SSE state
    const responseTransition = live.handleResponseMetadata(
      makeResponseInput({ responseHandle: `h2` })
    )
    expect(responseTransition.state.kind).toBe(`live`)
    expect(responseTransition.state.sseFallbackToLongPolling).toBe(true)
    expect(responseTransition.state.consecutiveShortSseConnections).toBe(2)

    // onUpToDate from LiveState preserves SSE state
    const msgTransition = live.handleMessageBatch(
      makeMessageBatchInput({ hasUpToDateMessage: true })
    )
    expect(msgTransition.state.kind).toBe(`live`)
    expect(msgTransition.state.sseFallbackToLongPolling).toBe(true)
    expect(msgTransition.state.consecutiveShortSseConnections).toBe(2)
  })

  // 13. ReplayingState suppresses up-to-date when cursor unchanged
  it(`suppresses one replay up-to-date when cursor is unchanged`, () => {
    const replaying = new ReplayingState({
      ...makeShared(),
      replayCursor: `cursor-1`,
    })

    const transition = replaying.handleMessageBatch(
      makeMessageBatchInput({ currentCursor: `cursor-1` })
    )

    expect(transition.suppressBatch).toBe(true)
    expect(transition.state).toBeInstanceOf(LiveState)
    expect(transition.state.replayCursor).toBe(undefined)
  })

  // 14. ReplayingState does not suppress when cursor changed
  it(`does not suppress replay up-to-date when cursor changed`, () => {
    const replaying = new ReplayingState({
      ...makeShared({ liveCacheBuster: `cursor-2` }),
      replayCursor: `cursor-1`,
    })

    const transition = replaying.handleMessageBatch(
      makeMessageBatchInput({ currentCursor: `cursor-2` })
    )

    expect(transition.suppressBatch).toBe(false)
    expect(transition.state).toBeInstanceOf(LiveState)
  })

  // 15. ReplayingState does not suppress SSE messages
  it(`does not suppress replay up-to-date for SSE messages`, () => {
    const replaying = new ReplayingState({
      ...makeShared(),
      replayCursor: `cursor-1`,
    })

    const transition = replaying.handleMessageBatch(
      makeMessageBatchInput({ isSse: true, currentCursor: `cursor-1` })
    )

    expect(transition.suppressBatch).toBe(false)
    expect(transition.state).toBeInstanceOf(LiveState)
  })

  // 16. InitialState/SyncingState enterReplayMode with cursor → ReplayingState
  it(`InitialState and SyncingState enterReplayMode returns ReplayingState`, () => {
    const { state: initial } = scenario().done()
    const replaying = initial.enterReplayMode(`cursor-1`)
    expect(replaying).toBeInstanceOf(ReplayingState)

    const { state: syncing } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .done()
    const replaying2 = syncing.enterReplayMode(`cursor-2`)
    expect(replaying2).toBeInstanceOf(ReplayingState)
  })

  // 17. LiveState enterReplayMode returns this (no-op)
  it(`LiveState enterReplayMode returns this`, () => {
    const { state } = scenario().messages().expectKind(`live`).done()
    expect(state.enterReplayMode(`cursor-1`)).toBe(state)
  })

  // 18. PausedState.resume returns previous state
  it(`PausedState.resume returns previous state`, () => {
    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .pause()
      .expectKind(`paused`)
      .resume()
      .expectKind(`syncing`)
      .done()
  })

  // 19. PausedState.isUpToDate delegates to previous
  it(`PausedState.isUpToDate delegates to previous state`, () => {
    scenario()
      .messages()
      .expectKind(`live`)
      .pause()
      .expectKind(`paused`)
      .expectUpToDate(true)
      .done()

    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .pause()
      .expectKind(`paused`)
      .expectUpToDate(false)
      .done()
  })

  // 20. ErrorState.retry returns previous state
  it(`ErrorState.retry returns previous state`, () => {
    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .error(new Error(`boom`))
      .expectKind(`error`)
      .retry()
      .expectKind(`syncing`)
      .expectHandle(`h1`)
      .done()
  })

  // 21. ErrorState.reset creates fresh InitialState
  it(`ErrorState.reset creates fresh InitialState`, () => {
    const { state: errored } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .error(new Error(`boom`))
      .expectKind(`error`)
      .done()

    const reset = (errored as ErrorState).reset(`new-handle`)
    expect(reset).toBeInstanceOf(InitialState)
    expect(reset.handle).toBe(`new-handle`)
    expect(reset.offset).toBe(`-1`)
    expect(reset.schema).toBe(undefined)
  })

  // 22. markMustRefetch resets to InitialState with correct defaults
  it(`markMustRefetch resets to InitialState with correct defaults`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, now: 12345 })
      .expectKind(`syncing`)
      .messages({ now: 12345 })
      .expectKind(`live`)
      .markMustRefetch(`new-handle`)
      .expectKind(`initial`)
      .expectOffset(`-1`)
      .expectHandle(`new-handle`)
      .done()

    expect(state.liveCacheBuster).toBe(``)
    expect(state.lastSyncedAt).toBe(12345)
    expect(state.schema).toBe(undefined)
    expect(state.isUpToDate).toBe(false)
  })

  // 23. StaleRetryState → SyncingState on successful response
  it(`StaleRetryState → SyncingState on successful response`, () => {
    const { state } = scenario()
      .response({
        responseHandle: `stale-h`,
        expiredHandle: `stale-h`,
      })
      .expectAction(`stale-retry`)
      .expectKind(`stale-retry`)
      .response({ responseHandle: `fresh-handle` })
      .expectAction(`accepted`)
      .expectKind(`syncing`)
      .expectHandle(`fresh-handle`)
      .done()

    expect(state.staleCacheBuster).toBe(undefined)
    expect(state.staleCacheRetryCount).toBe(0)
  })

  // 24. StaleRetryState exceededMaxRetries flag
  it(`StaleRetryState exceeds max retries`, () => {
    const stale = new StaleRetryState({
      ...makeShared({ handle: undefined }),
      staleCacheBuster: `cb-3`,
      staleCacheRetryCount: 3,
    })

    const transition = stale.handleResponseMetadata(
      makeResponseInput({
        responseHandle: `stale-handle`,
        expiredHandle: `stale-handle`,
      })
    )

    expect(transition.action).toBe(`stale-retry`)
    if (transition.action === `stale-retry`) {
      expect(transition.state.staleCacheRetryCount).toBe(4)
      expect(transition.exceededMaxRetries).toBe(true)
    }
  })

  // 25. Non-SSE states return no-op for shouldUseSse and handleSseConnectionClosed
  it(`non-LiveState returns false for shouldUseSse and no-op for handleSseConnectionClosed`, () => {
    const { state: syncing } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .done()

    expect(
      syncing.shouldUseSse({
        liveSseEnabled: true,
        isRefreshing: false,
        resumingFromPause: false,
      })
    ).toBe(false)

    const transition = syncing.handleSseConnectionClosed({
      connectionDuration: 100,
      wasAborted: false,
      minConnectionDuration: 1000,
      maxShortConnections: 3,
    })
    expect(transition.state).toBe(syncing)
    expect(transition.fellBackToLongPolling).toBe(false)
  })

  // 26. StaleRetryState canEnterReplayMode → false (entering replay mode would lose retry count)
  it(`StaleRetryState canEnterReplayMode returns false`, () => {
    const { state } = scenario()
      .response({
        responseHandle: `stale-h`,
        expiredHandle: `stale-h`,
      })
      .expectAction(`stale-retry`)
      .expectKind(`stale-retry`)
      .done()

    expect(state.canEnterReplayMode()).toBe(false)
  })

  // 27. enterReplayMode creates ReplayingState with cursor
  it(`enterReplayMode creates ReplayingState with cursor`, () => {
    const { state } = scenario()
      .enterReplayMode(`my-cursor`)
      .expectKind(`replaying`)
      .done()

    expect(state.replayCursor).toBe(`my-cursor`)
  })

  // 28. handleMessageBatch returns no-op when no messages
  it(`handleMessageBatch returns no-op when no messages`, () => {
    const syncing = new SyncingState(makeShared())

    const transition = syncing.handleMessageBatch(
      makeMessageBatchInput({ hasMessages: false })
    )

    expect(transition.state).toBe(syncing)
    expect(transition.suppressBatch).toBe(false)
    expect(transition.becameUpToDate).toBe(false)
  })

  // 29. handleMessageBatch with messages but no up-to-date
  it(`handleMessageBatch with messages but no up-to-date stays in same state`, () => {
    const syncing = new SyncingState(makeShared())

    const transition = syncing.handleMessageBatch(
      makeMessageBatchInput({ hasUpToDateMessage: false })
    )

    expect(transition.state).toBe(syncing)
    expect(transition.becameUpToDate).toBe(false)
  })

  // 30. LiveState.shouldUseSse returns false when fallen back to long polling
  it(`LiveState.shouldUseSse returns false when fallen back to long polling`, () => {
    const live = new LiveState(makeShared(), {
      sseFallbackToLongPolling: true,
    })

    expect(
      live.shouldUseSse({
        liveSseEnabled: true,
        isRefreshing: false,
        resumingFromPause: false,
      })
    ).toBe(false)
  })

  it(`LiveState.shouldUseSse returns false when isRefreshing`, () => {
    const { state } = scenario().messages().expectKind(`live`).done()

    expect(
      state.shouldUseSse({
        liveSseEnabled: true,
        isRefreshing: true,
        resumingFromPause: false,
      })
    ).toBe(false)
  })

  it(`LiveState.shouldUseSse returns false when resumingFromPause`, () => {
    const { state } = scenario().messages().expectKind(`live`).done()

    expect(
      state.shouldUseSse({
        liveSseEnabled: true,
        isRefreshing: false,
        resumingFromPause: true,
      })
    ).toBe(false)
  })

  // 31. PausedState delegates per-state field getters to previous
  it(`PausedState delegates per-state field getters to previous`, () => {
    const { state } = scenario()
      .response({
        responseHandle: `stale-h`,
        expiredHandle: `stale-h`,
      })
      .expectAction(`stale-retry`)
      .expectKind(`stale-retry`)
      .pause()
      .expectKind(`paused`)
      .done()

    expect(state.staleCacheBuster).toBeDefined()
    expect(state.staleCacheRetryCount).toBe(1)
  })

  // 32. ErrorState.isUpToDate delegates to previousState
  it(`ErrorState.isUpToDate delegates to previousState`, () => {
    scenario()
      .messages()
      .expectKind(`live`)
      .error(new Error(`oops`))
      .expectKind(`error`)
      .expectUpToDate(true)
      .done()

    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .error(new Error(`oops`))
      .expectKind(`error`)
      .expectUpToDate(false)
      .done()
  })

  // --- applyUrlParams tests ---

  function applyAndGetParams(
    state: ShapeStreamState,
    context?: Partial<UrlParamsContext>
  ): URLSearchParams {
    const url = new URL(`http://localhost:3000/v1/shape`)
    state.applyUrlParams(url, {
      isSnapshotRequest: false,
      canLongPoll: true,
      ...context,
    })
    return url.searchParams
  }

  it(`ActiveState sets offset and handle`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseOffset: `5_3` })
      .expectKind(`syncing`)
      .done()
    const params = applyAndGetParams(state)
    expect(params.get(OFFSET_QUERY_PARAM)).toBe(`5_3`)
    expect(params.get(SHAPE_HANDLE_QUERY_PARAM)).toBe(`h1`)
  })

  it(`ActiveState omits handle when undefined`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .done()
    const updated = state.withHandle(undefined as unknown as string)
    const params = applyAndGetParams(updated)
    expect(params.has(SHAPE_HANDLE_QUERY_PARAM)).toBe(false)
  })

  it(`StaleRetryState adds stale cache buster`, () => {
    const { state } = scenario()
      .response({
        responseHandle: `stale-h`,
        expiredHandle: `stale-h`,
      })
      .expectAction(`stale-retry`)
      .expectKind(`stale-retry`)
      .done()
    const params = applyAndGetParams(state)
    expect(params.get(CACHE_BUSTER_QUERY_PARAM)).toBe(state.staleCacheBuster)
  })

  it(`LiveState adds live cache buster and live param`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseCursor: `cur-42` })
      .expectKind(`syncing`)
      .messages({ currentCursor: `cur-42` })
      .expectKind(`live`)
      .done()
    const params = applyAndGetParams(state)
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.get(LIVE_QUERY_PARAM)).toBe(`true`)
  })

  it(`LiveState omits live params for snapshot requests`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseCursor: `cur-42` })
      .expectKind(`syncing`)
      .messages({ currentCursor: `cur-42` })
      .expectKind(`live`)
      .done()
    const params = applyAndGetParams(state, { isSnapshotRequest: true })
    expect(params.has(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(false)
    expect(params.has(LIVE_QUERY_PARAM)).toBe(false)
  })

  it(`LiveState omits live query param when canLongPoll is false`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseCursor: `cur-42` })
      .expectKind(`syncing`)
      .messages({ currentCursor: `cur-42` })
      .expectKind(`live`)
      .done()
    const params = applyAndGetParams(state, { canLongPoll: false })
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.has(LIVE_QUERY_PARAM)).toBe(false)
  })

  it(`non-LiveState does not add live params`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseCursor: `cur-42` })
      .expectKind(`syncing`)
      .done()
    const params = applyAndGetParams(state)
    expect(params.has(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(false)
    expect(params.has(LIVE_QUERY_PARAM)).toBe(false)
  })

  it(`PausedState delegates applyUrlParams to previous state`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseCursor: `cur-42` })
      .expectKind(`syncing`)
      .messages({ currentCursor: `cur-42` })
      .expectKind(`live`)
      .pause()
      .expectKind(`paused`)
      .done()
    const params = applyAndGetParams(state)
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.get(LIVE_QUERY_PARAM)).toBe(`true`)
  })

  it(`ErrorState delegates applyUrlParams to previous state`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseCursor: `cur-42` })
      .expectKind(`syncing`)
      .messages({ currentCursor: `cur-42` })
      .expectKind(`live`)
      .error(new Error(`oops`))
      .expectKind(`error`)
      .done()
    const params = applyAndGetParams(state)
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.get(LIVE_QUERY_PARAM)).toBe(`true`)
  })

  // --- withHandle tests ---

  it(`withHandle preserves state kind and fields, only changes handle`, () => {
    const live = new LiveState(
      makeShared({
        handle: `old`,
        offset: `5_3`,
        liveCacheBuster: `cur-1`,
      }),
      {
        consecutiveShortSseConnections: 2,
        sseFallbackToLongPolling: true,
      }
    )
    const updated = live.withHandle(`new-handle`)

    expect(updated).toBeInstanceOf(LiveState)
    expect(updated.kind).toBe(`live`)
    expect(updated.handle).toBe(`new-handle`)
    expect(updated.offset).toBe(`5_3`)
    expect(updated.liveCacheBuster).toBe(`cur-1`)
    expect(updated.isUpToDate).toBe(true)
    expect(updated.consecutiveShortSseConnections).toBe(2)
    expect(updated.sseFallbackToLongPolling).toBe(true)
  })

  it(`withHandle on PausedState updates inner state handle`, () => {
    const { state } = scenario()
      .response({ responseHandle: `old`, responseOffset: `5_3` })
      .expectKind(`syncing`)
      .messages()
      .expectKind(`live`)
      .pause()
      .expectKind(`paused`)
      .withHandle(`new-handle`)
      .expectKind(`paused`)
      .expectHandle(`new-handle`)
      .expectOffset(`5_3`)
      .expectUpToDate(true)
      .done()

    expect(state.kind).toBe(`paused`)
  })
})

describe(`schema undefined + ignored stale response`, () => {
  it(`ignored stale response should return state unchanged (schema remains undefined)`, () => {
    // Scenario: client resumes from persisted handle/offset but has no schema yet.
    // First response is stale (responseHandle matches expiredHandle).
    // checkStaleResponse sees we have a local handle → returns 'ignored'.
    // The state machine correctly returns 'ignored' without updating any fields.
    // client.ts is responsible for skipping body parsing when it sees 'ignored'.
    const { state } = scenario({ handle: `my-handle` })
      .response({ responseHandle: `my-handle` })
      .expectAction(`accepted`)
      .expectKind(`syncing`)
      .response({
        responseHandle: `stale-handle`,
        expiredHandle: `stale-handle`,
        responseSchema: { id: { type: `text` } },
      })
      .expectAction(`ignored`)
      .done()

    expect(state.schema).toBeUndefined()
  })
})

describe(`scenario builder`, () => {
  it(`happy-path-live: Initial → Syncing → Live`, () => {
    scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .messages({ hasUpToDateMessage: true })
      .expectKind(`live`)
      .expectUpToDate(true)
      .done()
  })

  it(`pause-resume: preserves handle and offset`, () => {
    scenario()
      .response({ responseHandle: `h1`, responseOffset: `5_3` })
      .expectKind(`syncing`)
      .expectHandle(`h1`)
      .pause()
      .expectKind(`paused`)
      .expectHandle(`h1`)
      .expectOffset(`5_3`)
      .resume()
      .expectKind(`syncing`)
      .expectHandle(`h1`)
      .expectOffset(`5_3`)
      .done()
  })

  it(`error-retry: restores previous state`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .error(new Error(`boom`))
      .expectKind(`error`)
      .retry()
      .expectKind(`syncing`)
      .done()

    expect(state.handle).toBe(`h1`)
  })

  it(`markMustRefetch: resets to Initial with offset -1`, () => {
    scenario()
      .response({ responseHandle: `h1` })
      .messages({ hasUpToDateMessage: true })
      .expectKind(`live`)
      .markMustRefetch(`new-h`)
      .expectKind(`initial`)
      .expectOffset(`-1`)
      .expectHandle(`new-h`)
      .done()
  })

  // 204 means "no new data" so lastSyncedAt is set immediately.
  // 200 means "here's data" — lastSyncedAt is deferred to handleMessageBatch
  // when the up-to-date message arrives.
  it(`204 response sets lastSyncedAt`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .response({ status: 204, now: 1234567890 })
      .done()

    expect(state.lastSyncedAt).toBe(1234567890)
  })

  it(`200 response does not set lastSyncedAt`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .response({ status: 200, now: 9999 })
      .done()

    expect(state.lastSyncedAt).toBeUndefined()
  })

  it(`SSE up-to-date message updates offset via upToDateOffset`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .messages({
        isSse: true,
        upToDateOffset: `42_5`,
        currentCursor: `cursor-1`,
      })
      .done()

    expect(state.offset).toBe(`42_5`)
  })

  it(`non-SSE up-to-date message preserves existing offset`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseOffset: `5_0` })
      .expectKind(`syncing`)
      .messages({
        isSse: false,
        upToDateOffset: `42_5`,
        currentCursor: `cursor-1`,
      })
      .done()

    expect(state.offset).toBe(`5_0`)
  })

  it(`stale response when local handle matches expired handle`, () => {
    const { state } = scenario()
      .response({ responseHandle: `h1` })
      .expectKind(`syncing`)
      .expectHandle(`h1`)
      .response({
        responseHandle: `h1`,
        expiredHandle: `h1`,
      })
      .expectAction(`stale-retry`)
      .expectKind(`stale-retry`)
      .done()

    expect(state.staleCacheRetryCount).toBe(1)
  })

  it(`response adopts schema when state has none`, () => {
    const testSchema = { id: { type: `int4`, dims: 0 } }
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseSchema: testSchema })
      .expectKind(`syncing`)
      .done()

    expect(state.schema).toBe(testSchema)
  })

  it(`response does not overwrite existing schema`, () => {
    const firstSchema = { id: { type: `int4`, dims: 0 } }
    const secondSchema = { name: { type: `text`, dims: 0 } }
    const { state } = scenario()
      .response({ responseHandle: `h1`, responseSchema: firstSchema })
      .expectKind(`syncing`)
      .response({ responseSchema: secondSchema })
      .done()

    expect(state.schema).toBe(firstSchema)
  })
})

describe(`tier-2: transition truth table`, () => {
  const allStates = makeAllStates()

  const eventFactories: Record<EventType, () => EventSpec> = {
    response: () => ({ type: `response`, input: {} }),
    messages: () => ({ type: `messages`, input: {} }),
    sseClose: () => ({
      type: `sseClose`,
      input: {
        connectionDuration: 5000,
        wasAborted: false,
        minConnectionDuration: 1000,
        maxShortConnections: 3,
      },
    }),
    pause: () => ({ type: `pause` }),
    resume: () => ({ type: `resume` }),
    error: () => ({ type: `error`, error: new Error(`test`) }),
    retry: () => ({ type: `retry` }),
    markMustRefetch: () => ({ type: `markMustRefetch` }),
    withHandle: () => ({ type: `withHandle`, handle: `new-h` }),
    enterReplayMode: () => ({ type: `enterReplayMode`, cursor: `c1` }),
  }

  for (const { kind, state } of allStates) {
    const tableForKind = TRANSITION_TABLE[kind]
    if (!tableForKind) continue

    describe(`${kind}`, () => {
      for (const [eventType, expected] of Object.entries(tableForKind)) {
        it(`${kind} + ${eventType}: ${expected.description}`, () => {
          const event = eventFactories[eventType as EventType]()
          const result = applyEvent(state, event)
          assertStateInvariants(result.state)

          if (expected.sameReference) {
            expect(result.state).toBe(state)
          }
          if (expected.resultKind) {
            expect(result.state.kind).toBe(expected.resultKind)
          }
          if (
            expected.action &&
            result.transition &&
            `action` in result.transition
          ) {
            expect(result.transition.action).toBe(expected.action)
          }
          if (
            expected.becameUpToDate !== undefined &&
            result.transition &&
            `becameUpToDate` in result.transition
          ) {
            expect(result.transition.becameUpToDate).toBe(
              expected.becameUpToDate
            )
          }
        })
      }
    })
  }
})

describe(`algebraic properties`, () => {
  const allStates = makeAllStates()

  it.each(allStates)(
    `pause/resume round-trip preserves handle and offset ($kind)`,
    ({ state }) => {
      const paused = state.pause()
      assertStateInvariants(paused)
      expect(paused.kind).toBe(`paused`)
      expect(paused.handle).toBe(state.handle)
      expect(paused.offset).toBe(state.offset)

      const resumed = (paused as PausedState).resume()
      assertStateInvariants(resumed)
      expect(resumed.handle).toBe(state.handle)
      expect(resumed.offset).toBe(state.offset)

      if (state instanceof PausedState) {
        // PausedState.pause() is idempotent, so resume returns previousState
        expect(resumed).toBe(state.previousState)
      } else {
        // Non-paused: reference identity holds
        expect(resumed).toBe(state)
      }
    }
  )

  it.each(allStates)(
    `error/retry round-trip restores previousState by reference ($kind)`,
    ({ state }) => {
      const errored = state.toErrorState(new Error(`test`))
      assertStateInvariants(errored)
      expect(errored.kind).toBe(`error`)
      expect(errored.error.message).toBe(`test`)

      const retried = errored.retry()
      assertStateInvariants(retried)
      if (state instanceof ErrorState) {
        // Same-type nesting guard unwraps: Error(Error(X)).retry() → X
        expect(retried).toBe(state.previousState)
      } else {
        expect(retried).toBe(state)
      }
    }
  )

  it.each(allStates)(
    `withHandle updates handle, preserves offset ($kind)`,
    ({ state }) => {
      const updated = state.withHandle(`new-handle`)
      assertStateInvariants(updated)
      expect(updated.handle).toBe(`new-handle`)
      expect(updated.offset).toBe(state.offset)
    }
  )

  it.each(allStates)(
    `markMustRefetch always produces InitialState with offset -1 ($kind)`,
    ({ state }) => {
      const fresh = state.markMustRefetch(`fresh-h`)
      assertStateInvariants(fresh)
      expect(fresh).toBeInstanceOf(InitialState)
      expect(fresh.offset).toBe(`-1`)
      expect(fresh.handle).toBe(`fresh-h`)
    }
  )

  it.each(allStates)(
    `PausedState.pause() is idempotent ($kind)`,
    ({ state }) => {
      const paused = state.pause()
      expect(paused.pause()).toBe(paused)
    }
  )

  it.each(allStates)(
    `enterReplayMode is a no-op for base-class states ($kind)`,
    ({ state }) => {
      if (
        !(state instanceof InitialState) &&
        !(state instanceof SyncingState) &&
        !(state instanceof StaleRetryState)
      ) {
        expect(state.enterReplayMode(`test-cursor`)).toBe(state)
      }
    }
  )

  it(`same-type nesting is prevented`, () => {
    const syncing = new SyncingState(makeShared())

    // PausedState unwraps Paused(Paused(X)) → Paused(X)
    const paused = syncing.pause()
    const doublePaused = new PausedState(paused)
    expect(doublePaused.previousState).not.toBeInstanceOf(PausedState)
    expect(doublePaused.previousState).toBe(syncing)

    // ErrorState unwraps Error(Error(X)) → Error(X) with newer error
    const err1 = syncing.toErrorState(new Error(`first`))
    const err2 = err1.toErrorState(new Error(`second`))
    expect(err2.previousState).not.toBeInstanceOf(ErrorState)
    expect(err2.previousState).toBe(syncing)
    expect(err2.error.message).toBe(`second`)

    // Cross-type nesting is preserved: Paused(Error(X)) is valid
    const pausedError = err1.pause()
    expect(pausedError.previousState).toBeInstanceOf(ErrorState)

    // Cross-type nesting is preserved: Error(Paused(X)) is valid
    const errorPaused = paused.toErrorState(new Error(`oops`))
    expect(errorPaused.previousState).toBeInstanceOf(PausedState)
  })
})

describe(`fuzz testing`, () => {
  const IS_COVERAGE = process.env.npm_lifecycle_event === `coverage`
  const SINGLE_SEED = process.env.FUZZ_SEED
    ? parseInt(process.env.FUZZ_SEED)
    : undefined
  const SEEDS =
    SINGLE_SEED !== undefined
      ? 1
      : process.env.FUZZ_DEEP
        ? 1000
        : IS_COVERAGE
          ? 20
          : 100
  const STEPS = process.env.FUZZ_DEEP ? 50 : IS_COVERAGE ? 15 : 30

  it(`survives ${SEEDS} random ${STEPS}-step sequences`, () => {
    const seedsToRun =
      SINGLE_SEED !== undefined
        ? [SINGLE_SEED]
        : Array.from({ length: SEEDS }, (_, i) => i)

    for (const seed of seedsToRun) {
      let state: ShapeStreamState = createInitialState({ offset: `-1` })
      const rng = mulberry32(seed)
      const trace: EventSpec[] = []
      try {
        for (let step = 0; step < STEPS; step++) {
          const now = seed * 1_000_000 + step
          const event = pickRandomEvent(rng, now)
          trace.push(event)
          const result = applyEvent(state, event)
          assertStateInvariants(result.state)
          assertReachableInvariants(event, result.prevState, result.state)
          state = result.state
        }
      } catch (e) {
        const shrunk = shrinkFailingSequence(trace, (t) => {
          try {
            replayEvents(t)
            return false
          } catch (shrinkErr) {
            if (shrinkErr instanceof Error && e instanceof Error) {
              return shrinkErr.constructor === e.constructor
            }
            return false
          }
        })
        throw new Error(
          `Fuzz failed: seed=${seed} steps=${trace.length} shrunk=${shrunk.length}\n` +
            `Rerun: FUZZ_SEED=${seed} pnpm vitest run shape-stream-state\n` +
            `Shrunk trace: ${JSON.stringify(shrunk.map((e) => e.type))}\n` +
            `Original error: ${e instanceof Error ? e.message : e}`
        )
      }
    }
  })
})

describe(`mutation testing`, () => {
  for (const [name, buildScenario] of Object.entries(standardScenarios)) {
    describe(`mutating ${name}`, () => {
      it(`standard scenario runs cleanly`, () => {
        buildScenario().done()
      })

      it(`survives event duplication`, () => {
        const { trace } = buildScenario().done()
        const events = trace.map((t) => t.event)
        for (let i = 0; i < events.length; i++) {
          const mutated = duplicateEvent(events, i)
          const results = rawEvents(
            createInitialState({ offset: `-1` }),
            mutated
          )
          results.forEach((r) => assertStateInvariants(r.state))
        }
      })

      it(`survives event reordering`, () => {
        const { trace } = buildScenario().done()
        const events = trace.map((t) => t.event)
        for (let i = 0; i < events.length - 1; i++) {
          const mutated = reorderEvents(events, i, i + 1)
          const results = rawEvents(
            createInitialState({ offset: `-1` }),
            mutated
          )
          results.forEach((r) => assertStateInvariants(r.state))
        }
      })

      it(`survives event dropping`, () => {
        const { trace } = buildScenario().done()
        const events = trace.map((t) => t.event)
        for (let i = 0; i < events.length; i++) {
          const mutated = dropEvent(events, i)
          const results = rawEvents(
            createInitialState({ offset: `-1` }),
            mutated
          )
          results.forEach((r) => assertStateInvariants(r.state))
        }
      })
    })
  }
})
