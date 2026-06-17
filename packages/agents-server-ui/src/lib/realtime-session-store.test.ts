import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeAudioSession } from './realtime-audio'
import {
  adoptSharedRealtimeSession,
  createRealtimeSessionKey,
  releaseSharedRealtimeSession,
  resetSharedRealtimeSessionsForTest,
  stopSharedRealtimeSession,
  storeSharedRealtimeSession,
} from './realtime-session-store'

function createSession(sessionId: string): RealtimeAudioSession {
  return {
    sessionId,
    sendText: vi.fn(),
    setInputLevelHandler: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  }
}

describe(`realtime session store`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetSharedRealtimeSessionsForTest()
    vi.useRealTimers()
  })

  it(`keeps a released session alive when it is adopted before the grace period expires`, async () => {
    const key = createRealtimeSessionKey(`http://localhost:4437`, `/horton/a`)
    const session = createSession(`session-1`)

    storeSharedRealtimeSession(key, session)
    releaseSharedRealtimeSession(key, session, 1_000)
    await vi.advanceTimersByTimeAsync(999)

    expect(session.stop).not.toHaveBeenCalled()
    expect(adoptSharedRealtimeSession(key)).toBe(session)

    await vi.advanceTimersByTimeAsync(1)
    expect(session.stop).not.toHaveBeenCalled()
    expect(adoptSharedRealtimeSession(key)).toBe(session)
  })

  it(`stops a released session after the grace period when no composer adopts it`, async () => {
    const key = createRealtimeSessionKey(`http://localhost:4437`, `/horton/a`)
    const session = createSession(`session-1`)

    storeSharedRealtimeSession(key, session)
    releaseSharedRealtimeSession(key, session, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(session.stop).toHaveBeenCalledTimes(1)
    expect(adoptSharedRealtimeSession(key)).toBeNull()
  })

  it(`explicit stop cancels a pending release and closes the session once`, async () => {
    const key = createRealtimeSessionKey(`http://localhost:4437`, `/horton/a`)
    const session = createSession(`session-1`)

    storeSharedRealtimeSession(key, session)
    releaseSharedRealtimeSession(key, session, 1_000)
    await stopSharedRealtimeSession(key, session)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(session.stop).toHaveBeenCalledTimes(1)
    expect(adoptSharedRealtimeSession(key)).toBeNull()
  })

  it(`does not release a session until every adopted composer releases it`, async () => {
    const key = createRealtimeSessionKey(`http://localhost:4437`, `/horton/a`)
    const session = createSession(`session-1`)

    storeSharedRealtimeSession(key, session)
    expect(adoptSharedRealtimeSession(key)).toBe(session)

    releaseSharedRealtimeSession(key, session, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(session.stop).not.toHaveBeenCalled()

    releaseSharedRealtimeSession(key, session, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(session.stop).toHaveBeenCalledTimes(1)
    expect(adoptSharedRealtimeSession(key)).toBeNull()
  })
})
