import type { RealtimeAudioSession } from './realtime-audio'

const REALTIME_SESSION_RELEASE_DELAY_MS = 5_000

type SharedRealtimeSession = {
  session: RealtimeAudioSession
  leases: number
  releaseTimer: ReturnType<typeof setTimeout> | null
}

const sharedRealtimeSessions = new Map<string, SharedRealtimeSession>()

export function createRealtimeSessionKey(
  baseUrl: string,
  entityUrl: string
): string {
  return `${baseUrl}\n${entityUrl}`
}

export function adoptSharedRealtimeSession(
  key: string
): RealtimeAudioSession | null {
  const entry = sharedRealtimeSessions.get(key)
  if (!entry) return null
  clearReleaseTimer(entry)
  entry.leases += 1
  return entry.session
}

export function storeSharedRealtimeSession(
  key: string,
  session: RealtimeAudioSession
): void {
  const existing = sharedRealtimeSessions.get(key)
  if (existing?.session === session) {
    clearReleaseTimer(existing)
    return
  }
  if (existing) {
    clearReleaseTimer(existing)
    void existing.session.stop()
  }
  sharedRealtimeSessions.set(key, { session, leases: 1, releaseTimer: null })
}

export function releaseSharedRealtimeSession(
  key: string,
  session: RealtimeAudioSession,
  delayMs = REALTIME_SESSION_RELEASE_DELAY_MS
): void {
  const entry = sharedRealtimeSessions.get(key)
  if (!entry || entry.session !== session || entry.releaseTimer) return
  entry.leases = Math.max(0, entry.leases - 1)
  if (entry.leases > 0) return
  entry.releaseTimer = setTimeout(() => {
    if (sharedRealtimeSessions.get(key) !== entry) return
    sharedRealtimeSessions.delete(key)
    void session.stop()
  }, delayMs)
}

export async function stopSharedRealtimeSession(
  key: string,
  session: RealtimeAudioSession
): Promise<void> {
  const entry = sharedRealtimeSessions.get(key)
  if (entry?.session === session) {
    clearReleaseTimer(entry)
    sharedRealtimeSessions.delete(key)
  }
  await session.stop()
}

export function resetSharedRealtimeSessionsForTest(): void {
  for (const entry of sharedRealtimeSessions.values()) {
    clearReleaseTimer(entry)
  }
  sharedRealtimeSessions.clear()
}

function clearReleaseTimer(entry: SharedRealtimeSession): void {
  if (!entry.releaseTimer) return
  clearTimeout(entry.releaseTimer)
  entry.releaseTimer = null
}
