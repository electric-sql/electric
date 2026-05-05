import { createEntityStreamDB } from '@electric-ax/agents-runtime'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

function getMainStreamPath(entityUrl: string): string {
  return `${entityUrl}/main`
}

/**
 * Entity-side custom state collections to register on the UI-side
 * StreamDB so `db.collections[name]` resolves. Shape matches
 * `EntityDefinition['state']` — type + primaryKey are the minimum
 * needed; schema defaults to passthrough on the read side.
 */
export type UICustomState = Record<string, { type: string; primaryKey: string }>

let activeBaseUrl: string | null = null

export function registerActiveBaseUrl(url: string | null): void {
  activeBaseUrl = url
}

export function getActiveBaseUrl(): string | null {
  return activeBaseUrl
}

type CachedConnection = {
  promise: Promise<{ db: EntityStreamDBWithActions; close: () => void }>
  refs: number
  evictionTimer: ReturnType<typeof setTimeout> | null
}

const connectionCache = new Map<string, CachedConnection>()

function cacheKey(baseUrl: string, entityUrl: string): string {
  return `${baseUrl}${entityUrl}`
}

function clearEvictionTimer(entry: CachedConnection): void {
  if (entry.evictionTimer) {
    clearTimeout(entry.evictionTimer)
    entry.evictionTimer = null
  }
}

function scheduleEviction(key: string, entry: CachedConnection): void {
  clearEvictionTimer(entry)
  entry.evictionTimer = setTimeout(() => {
    if (entry.refs > 0 || connectionCache.get(key) !== entry) return
    connectionCache.delete(key)
    entry.promise
      .then(({ close }) => close())
      .catch(() => {
        // Failed preload entries are removed by their rejection handler.
      })
  }, 30_000)
}

function abortError(): DOMException {
  return new DOMException(`Entity stream preload was aborted`, `AbortError`)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function getOrCreateConnection(opts: {
  baseUrl: string
  entityUrl: string
  customState?: UICustomState
  signal?: AbortSignal
}): { key: string; entry: CachedConnection } {
  const { baseUrl, entityUrl, customState, signal } = opts
  const key = cacheKey(baseUrl, entityUrl)
  const existing = connectionCache.get(key)
  if (existing) {
    clearEvictionTimer(existing)
    return { key, entry: existing }
  }

  const promise = connectEntityStreamFresh({
    baseUrl,
    entityUrl,
    customState,
    signal,
  })
  const entry: CachedConnection = { promise, refs: 0, evictionTimer: null }
  connectionCache.set(key, entry)
  promise.catch(() => {
    if (connectionCache.get(key) === entry) connectionCache.delete(key)
  })
  return { key, entry }
}

async function preloadWithAbort(
  db: EntityStreamDBWithActions,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) {
    await db.preload()
    return
  }

  throwIfAborted(signal)

  let abort: (() => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(abortError())
    signal.addEventListener(`abort`, abort, { once: true })
  })

  try {
    await Promise.race([db.preload(), aborted])
  } finally {
    if (abort) {
      signal.removeEventListener(`abort`, abort)
    }
  }
}

export async function preloadEntityStream(opts: {
  baseUrl: string
  entityUrl: string
  customState?: UICustomState
  signal?: AbortSignal
}): Promise<void> {
  const { key, entry } = getOrCreateConnection(opts)
  try {
    await entry.promise
    if (entry.refs === 0) scheduleEviction(key, entry)
  } catch {
    // Route preloading should not surface as navigation failure.
  }
}

export async function connectEntityStream(opts: {
  baseUrl: string
  entityUrl: string
  customState?: UICustomState
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const { key, entry } = getOrCreateConnection(opts)
  entry.refs += 1
  try {
    const { db } = await entry.promise
    let closed = false
    return {
      db,
      close: () => {
        if (closed) return
        closed = true
        entry.refs = Math.max(0, entry.refs - 1)
        if (entry.refs === 0) scheduleEviction(key, entry)
      },
    }
  } catch (err) {
    entry.refs = Math.max(0, entry.refs - 1)
    throw err
  }
}

async function connectEntityStreamFresh(opts: {
  baseUrl: string
  entityUrl: string
  customState?: UICustomState
  signal?: AbortSignal
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const { baseUrl, entityUrl, customState, signal } = opts
  throwIfAborted(signal)
  const res = await fetch(`${baseUrl}${entityUrl}`, {
    headers: { accept: `application/json` },
    signal,
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch entity at ${entityUrl}: ${res.statusText}`)
  }
  await res.body?.cancel()
  throwIfAborted(signal)
  const streamUrl = `${baseUrl}${getMainStreamPath(entityUrl)}`
  const db = createEntityStreamDB(
    streamUrl,
    customState as unknown as Parameters<typeof createEntityStreamDB>[1]
  )
  try {
    await preloadWithAbort(db, signal)
  } catch (err) {
    db.close()
    throw err
  }

  return { db, close: () => db.close() }
}
