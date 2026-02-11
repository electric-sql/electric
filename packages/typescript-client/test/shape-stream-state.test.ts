import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  ErrorState,
  InitialState,
  LiveState,
  PausedState,
  ReplayingState,
  ResponseMetadataInput,
  MessageBatchInput,
  UrlParamsContext,
  StaleRetryState,
  SyncingState,
  SharedStateFields,
} from '../src/shape-stream-state'
import {
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  CACHE_BUSTER_QUERY_PARAM,
} from '../src/constants'

function makeShared(overrides?: Partial<SharedStateFields>): SharedStateFields {
  return {
    handle: `h1`,
    offset: `0_0`,
    schema: {},
    liveCacheBuster: `cursor-1`,
    lastSyncedAt: undefined,
    ...overrides,
  }
}

function makeResponseInput(
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

function makeMessageBatchInput(
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

describe(`shape stream state machine`, () => {
  // 1. InitialState → SyncingState on valid response
  it(`transitions InitialState → SyncingState on valid response`, () => {
    const initial = createInitialState({ offset: `-1` })

    const transition = initial.handleResponseMetadata(
      makeResponseInput({ responseHandle: `new-handle` })
    )

    expect(transition.action).toBe(`accepted`)
    expect(transition.state).toBeInstanceOf(SyncingState)
    expect(transition.state.handle).toBe(`new-handle`)
  })

  // 2. InitialState → StaleRetryState on stale handle with no local handle
  it(`enters stale-retry state for stale handle when local handle is missing`, () => {
    const initial = createInitialState({ offset: `-1`, handle: undefined })

    const transition = initial.handleResponseMetadata(
      makeResponseInput({
        responseHandle: `stale-handle`,
        expiredHandle: `stale-handle`,
      })
    )

    expect(transition.action).toBe(`stale-retry`)
    if (transition.action === `stale-retry`) {
      expect(transition.state).toBeInstanceOf(StaleRetryState)
      expect(transition.state.staleCacheRetryCount).toBe(1)
      expect(transition.state.staleCacheBuster).toBe(`cb-1`)
      expect(transition.exceededMaxRetries).toBe(false)
    }
  })

  // 3. SyncingState ignores stale response when it has a valid handle
  it(`ignores stale response metadata when local handle exists`, () => {
    const syncing = new SyncingState(makeShared({ handle: `good-handle` }))

    const transition = syncing.handleResponseMetadata(
      makeResponseInput({
        responseHandle: `expired-handle`,
        responseOffset: `999_999`,
        responseCursor: `cursor-stale`,
        expiredHandle: `expired-handle`,
      })
    )

    expect(transition.action).toBe(`ignored`)
    expect(transition.state.kind).toBe(`syncing`)
    expect(transition.state.handle).toBe(`good-handle`)
    expect(transition.state.offset).toBe(`0_0`)
    expect(transition.state.liveCacheBuster).toBe(`cursor-1`)
  })

  // 4. SyncingState → LiveState on up-to-date message
  it(`transitions SyncingState → LiveState on up-to-date message`, () => {
    const syncing = new SyncingState(makeShared())

    const transition = syncing.handleMessageBatch(makeMessageBatchInput())

    expect(transition.state).toBeInstanceOf(LiveState)
    expect(transition.becameUpToDate).toBe(true)
    expect(transition.suppressBatch).toBe(false)
  })

  // 5. LiveState stays LiveState on subsequent up-to-date
  it(`LiveState stays LiveState on subsequent up-to-date`, () => {
    const live = new LiveState(makeShared({ lastSyncedAt: 1000 }))

    const transition = live.handleMessageBatch(makeMessageBatchInput())

    expect(transition.state).toBeInstanceOf(LiveState)
    expect(transition.becameUpToDate).toBe(true)
  })

  // 6. LiveState.isUpToDate returns true
  it(`LiveState.isUpToDate returns true`, () => {
    const live = new LiveState(makeShared())
    expect(live.isUpToDate).toBe(true)
  })

  // 7. InitialState/SyncingState.isUpToDate returns false
  it(`InitialState and SyncingState.isUpToDate return false`, () => {
    const initial = createInitialState({ offset: `-1` })
    const syncing = new SyncingState(makeShared())

    expect(initial.isUpToDate).toBe(false)
    expect(syncing.isUpToDate).toBe(false)
  })

  // 8. LiveState.shouldUseSse returns true when conditions met
  it(`LiveState.shouldUseSse returns true when conditions met`, () => {
    const live = new LiveState(makeShared())

    expect(
      live.shouldUseSse({
        liveSseEnabled: true,
        isRefreshing: false,
        resumingFromPause: false,
      })
    ).toBe(true)
  })

  // 9. LiveState.shouldUseSse returns false when SSE disabled
  it(`LiveState.shouldUseSse returns false when SSE disabled`, () => {
    const live = new LiveState(makeShared())

    expect(
      live.shouldUseSse({
        liveSseEnabled: false,
        isRefreshing: false,
        resumingFromPause: false,
      })
    ).toBe(false)
  })

  // 10. LiveState.handleSseConnectionClosed — healthy connection resets counter
  it(`LiveState resets counter on healthy SSE connection`, () => {
    const live = new LiveState(makeShared(), {
      consecutiveShortSseConnections: 2,
    })

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

  // 16. InitialState/SyncingState canEnterReplayMode → true
  it(`InitialState and SyncingState canEnterReplayMode returns true`, () => {
    const initial = createInitialState({ offset: `-1` })
    const syncing = new SyncingState(makeShared())

    expect(initial.canEnterReplayMode()).toBe(true)
    expect(syncing.canEnterReplayMode()).toBe(true)
  })

  // 17. LiveState canEnterReplayMode → false
  it(`LiveState canEnterReplayMode returns false`, () => {
    const live = new LiveState(makeShared())
    expect(live.canEnterReplayMode()).toBe(false)
  })

  // 18. PausedState.resume returns previous state
  it(`PausedState.resume returns previous state`, () => {
    const syncing = new SyncingState(makeShared())
    const paused = syncing.pause()

    expect(paused).toBeInstanceOf(PausedState)
    const resumed = paused.resume()
    expect(resumed).toBeInstanceOf(SyncingState)
    expect(resumed).toBe(syncing)
  })

  // 19. PausedState.isUpToDate delegates to previous
  it(`PausedState.isUpToDate delegates to previous state`, () => {
    const live = new LiveState(makeShared())
    const pausedFromLive = live.pause()
    expect(pausedFromLive.isUpToDate).toBe(true)

    const syncing = new SyncingState(makeShared())
    const pausedFromSyncing = syncing.pause()
    expect(pausedFromSyncing.isUpToDate).toBe(false)
  })

  // 20. ErrorState.retry returns previous state
  it(`ErrorState.retry returns previous state`, () => {
    const syncing = new SyncingState(makeShared())
    const errored = syncing.toErrorState(new Error(`boom`))

    expect(errored).toBeInstanceOf(ErrorState)
    expect(errored.error.message).toBe(`boom`)
    const retried = errored.retry()
    expect(retried).toBeInstanceOf(SyncingState)
    expect(retried).toBe(syncing)
  })

  // 21. ErrorState.reset creates fresh InitialState
  it(`ErrorState.reset creates fresh InitialState`, () => {
    const syncing = new SyncingState(makeShared())
    const errored = syncing.toErrorState(new Error(`boom`))

    const reset = errored.reset(`new-handle`)
    expect(reset).toBeInstanceOf(InitialState)
    expect(reset.handle).toBe(`new-handle`)
    expect(reset.offset).toBe(`-1`)
    expect(reset.schema).toBe(undefined)
  })

  // 22. markMustRefetch resets to InitialState with correct defaults
  it(`markMustRefetch resets to InitialState with correct defaults`, () => {
    const live = new LiveState(
      makeShared({ handle: `old-handle`, lastSyncedAt: 12345 })
    )

    const fresh = live.markMustRefetch(`new-handle`)
    expect(fresh).toBeInstanceOf(InitialState)
    expect(fresh.handle).toBe(`new-handle`)
    expect(fresh.offset).toBe(`-1`)
    expect(fresh.liveCacheBuster).toBe(``)
    expect(fresh.lastSyncedAt).toBe(12345)
    expect(fresh.schema).toBe(undefined)
    expect(fresh.isUpToDate).toBe(false)
  })

  // 23. StaleRetryState → SyncingState on successful response
  it(`StaleRetryState → SyncingState on successful response`, () => {
    const stale = new StaleRetryState({
      ...makeShared({ handle: undefined }),
      staleCacheBuster: `cb-1`,
      staleCacheRetryCount: 1,
    })

    const transition = stale.handleResponseMetadata(
      makeResponseInput({ responseHandle: `fresh-handle` })
    )

    expect(transition.action).toBe(`accepted`)
    expect(transition.state).toBeInstanceOf(SyncingState)
    expect(transition.state.handle).toBe(`fresh-handle`)
    // Stale tracking should be cleared
    expect(transition.state.staleCacheBuster).toBe(undefined)
    expect(transition.state.staleCacheRetryCount).toBe(0)
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
    const syncing = new SyncingState(makeShared())

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
    const stale = new StaleRetryState({
      ...makeShared(),
      staleCacheBuster: `cb-1`,
      staleCacheRetryCount: 1,
    })

    expect(stale.canEnterReplayMode()).toBe(false)
  })

  // 27. enterReplayMode creates ReplayingState with cursor
  it(`enterReplayMode creates ReplayingState with cursor`, () => {
    const initial = createInitialState({ offset: `-1` })
    const replaying = initial.enterReplayMode(`my-cursor`)

    expect(replaying).toBeInstanceOf(ReplayingState)
    expect(replaying.replayCursor).toBe(`my-cursor`)
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

  // 31. PausedState delegates per-state field getters to previous
  it(`PausedState delegates per-state field getters to previous`, () => {
    const stale = new StaleRetryState({
      ...makeShared(),
      staleCacheBuster: `cb-1`,
      staleCacheRetryCount: 2,
    })

    const paused = stale.pause()
    expect(paused.staleCacheBuster).toBe(`cb-1`)
    expect(paused.staleCacheRetryCount).toBe(2)
  })

  // 32. ErrorState.isUpToDate delegates to previous
  it(`ErrorState.isUpToDate delegates to previous state`, () => {
    const live = new LiveState(makeShared())
    const errored = live.toErrorState(new Error(`oops`))
    expect(errored.isUpToDate).toBe(true)

    const syncing = new SyncingState(makeShared())
    const errored2 = syncing.toErrorState(new Error(`oops`))
    expect(errored2.isUpToDate).toBe(false)
  })

  // --- applyUrlParams tests ---

  function applyAndGetParams(
    state: InstanceType<
      | typeof InitialState
      | typeof SyncingState
      | typeof LiveState
      | typeof StaleRetryState
      | typeof ReplayingState
      | typeof PausedState
      | typeof ErrorState
    >,
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
    const state = new SyncingState(makeShared({ handle: `h1`, offset: `5_3` }))
    const params = applyAndGetParams(state)
    expect(params.get(OFFSET_QUERY_PARAM)).toBe(`5_3`)
    expect(params.get(SHAPE_HANDLE_QUERY_PARAM)).toBe(`h1`)
  })

  it(`ActiveState omits handle when undefined`, () => {
    const state = new SyncingState(makeShared({ handle: undefined }))
    const params = applyAndGetParams(state)
    expect(params.has(SHAPE_HANDLE_QUERY_PARAM)).toBe(false)
  })

  it(`StaleRetryState adds stale cache buster`, () => {
    const state = new StaleRetryState({
      ...makeShared(),
      staleCacheBuster: `buster-123`,
      staleCacheRetryCount: 1,
    })
    const params = applyAndGetParams(state)
    expect(params.get(CACHE_BUSTER_QUERY_PARAM)).toBe(`buster-123`)
  })

  it(`LiveState adds live cache buster and live param`, () => {
    const state = new LiveState(makeShared({ liveCacheBuster: `cur-42` }))
    const params = applyAndGetParams(state)
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.get(LIVE_QUERY_PARAM)).toBe(`true`)
  })

  it(`LiveState omits live params for snapshot requests`, () => {
    const state = new LiveState(makeShared({ liveCacheBuster: `cur-42` }))
    const params = applyAndGetParams(state, { isSnapshotRequest: true })
    expect(params.has(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(false)
    expect(params.has(LIVE_QUERY_PARAM)).toBe(false)
    // base params still present
    expect(params.get(OFFSET_QUERY_PARAM)).toBe(`0_0`)
  })

  it(`LiveState omits live query param when canLongPoll is false`, () => {
    const state = new LiveState(makeShared({ liveCacheBuster: `cur-42` }))
    const params = applyAndGetParams(state, { canLongPoll: false })
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.has(LIVE_QUERY_PARAM)).toBe(false)
  })

  it(`non-LiveState does not add live params`, () => {
    const state = new SyncingState(makeShared({ liveCacheBuster: `cur-42` }))
    const params = applyAndGetParams(state)
    expect(params.has(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(false)
    expect(params.has(LIVE_QUERY_PARAM)).toBe(false)
  })

  it(`PausedState delegates applyUrlParams to previous state`, () => {
    const live = new LiveState(makeShared({ liveCacheBuster: `cur-42` }))
    const paused = live.pause()
    const params = applyAndGetParams(paused)
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.get(LIVE_QUERY_PARAM)).toBe(`true`)
  })

  it(`ErrorState delegates applyUrlParams to previous state`, () => {
    const live = new LiveState(makeShared({ liveCacheBuster: `cur-42` }))
    const errored = live.toErrorState(new Error(`oops`))
    const params = applyAndGetParams(errored)
    expect(params.get(LIVE_CACHE_BUSTER_QUERY_PARAM)).toBe(`cur-42`)
    expect(params.get(LIVE_QUERY_PARAM)).toBe(`true`)
  })

  // --- withHandle tests ---

  it(`withHandle preserves state kind and fields, only changes handle`, () => {
    const shared = makeShared({
      handle: `old`,
      offset: `5_3`,
      liveCacheBuster: `cur-1`,
    })
    const live = new LiveState(shared, {
      consecutiveShortSseConnections: 2,
      sseFallbackToLongPolling: true,
    })
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
    const live = new LiveState(makeShared({ handle: `old`, offset: `5_3` }))
    const paused = live.pause()
    const updated = paused.withHandle(`new-handle`)

    expect(updated).toBeInstanceOf(PausedState)
    expect(updated.handle).toBe(`new-handle`)
    expect(updated.offset).toBe(`5_3`)
    expect(updated.isUpToDate).toBe(true)
  })
})

describe(`schema undefined + ignored stale response`, () => {
  it(`ignored stale response should return state unchanged (schema remains undefined)`, () => {
    // Scenario: client resumes from persisted handle/offset but has no schema yet.
    // First response is stale (responseHandle matches expiredHandle).
    // checkStaleResponse sees we have a local handle → returns 'ignored'.
    // The state machine correctly returns 'ignored' without updating any fields.
    // client.ts is responsible for skipping body parsing when it sees 'ignored'.
    const state = new SyncingState(
      makeShared({ handle: `my-handle`, schema: undefined })
    )

    const transition = state.handleResponseMetadata(
      makeResponseInput({
        responseHandle: `stale-handle`,
        expiredHandle: `stale-handle`,
        responseSchema: { id: { type: `text` } },
      })
    )

    expect(transition.action).toBe(`ignored`)
    expect(transition.state).toBe(state)
    expect(transition.state.schema).toBeUndefined()
  })
})
