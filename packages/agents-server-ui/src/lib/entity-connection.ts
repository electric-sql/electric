import { serverFetch } from './auth-fetch'
import { entityApiUrl } from './entity-api'
import { DurableStream } from '@durable-streams/client'
import type { StreamOptions } from '@durable-streams/client'
import {
  appendPathToUrl,
  commentsCollection,
  createEntityStreamDB,
  type EntityStreamDBWithActions,
} from '@electric-ax/agents-runtime/client'

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

/**
 * Collections the UI always registers on every entity stream so that
 * `db.collections.comments` (and any future UI-specific collections) are
 * guaranteed to be defined. Callers may overlay their own customState on
 * top; explicitly-passed entries take precedence.
 */
export const UI_ENTITY_CUSTOM_STATE: Record<string, typeof commentsCollection> =
  { comments: commentsCollection }

let activeBaseUrl: string | null = null

const ENTITY_METADATA_RETRY_DELAYS_MS = [250, 500, 1000, 2000]

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener(`abort`, onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(abortError())
    }
    signal.addEventListener(`abort`, onAbort, { once: true })
  })
}

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

type EntityStreamOptions = NonNullable<
  Parameters<typeof createEntityStreamDB>[3]
>
type EntityStreamHandle = NonNullable<EntityStreamOptions[`stream`]>

const connectionCache = new Map<string, CachedConnection>()

export function __clearEntityConnectionCacheForTests(): void {
  for (const entry of connectionCache.values()) {
    clearEvictionTimer(entry)
    entry.promise.then(({ close }) => close()).catch(() => {})
  }
  connectionCache.clear()
}

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

function isReactNativeRuntime(): boolean {
  return typeof navigator !== `undefined` && navigator.product === `ReactNative`
}

function createReactNativeStream(streamUrl: string): EntityStreamHandle {
  const stream = new DurableStream({
    url: streamUrl,
    contentType: `application/json`,
    fetch: serverFetch,
  })

  return {
    url: stream.url,
    stream: (options?: Omit<StreamOptions, `url`>) =>
      stream.stream({ ...options, live: `long-poll` }),
  } as EntityStreamHandle
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

async function fetchEntityMetadataWithSpawnRaceRetry(opts: {
  baseUrl: string
  entityUrl: string
  signal?: AbortSignal
}): Promise<Response> {
  const { baseUrl, entityUrl, signal } = opts
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(signal)
    const res = await serverFetch(entityApiUrl(baseUrl, entityUrl), {
      headers: { accept: `application/json` },
      signal,
    })
    if (res.ok) return res

    await res.body?.cancel()
    const retryDelay = ENTITY_METADATA_RETRY_DELAYS_MS[attempt]
    if (res.status !== 404 || retryDelay === undefined) {
      throw new Error(
        `Failed to fetch entity at ${entityUrl}: ${res.statusText || res.status}`
      )
    }
    await delay(retryDelay, signal)
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
  const res = await fetchEntityMetadataWithSpawnRaceRetry({
    baseUrl,
    entityUrl,
    signal,
  })
  await res.body?.cancel()
  throwIfAborted(signal)
  const streamUrl = appendPathToUrl(baseUrl, getMainStreamPath(entityUrl))
  const stream: EntityStreamHandle = isReactNativeRuntime()
    ? createReactNativeStream(streamUrl)
    : (new DurableStream({
        url: streamUrl,
        contentType: `application/json`,
        fetch: serverFetch,
      }) as unknown as EntityStreamHandle)
  const db = createEntityStreamDB(
    streamUrl,
    {
      ...UI_ENTITY_CUSTOM_STATE,
      ...(customState ?? {}),
    } as unknown as Parameters<typeof createEntityStreamDB>[1],
    undefined,
    { stream }
  )
  try {
    await preloadWithAbort(db, signal)
  } catch (err) {
    db.close()
    throw err
  }

  return { db, close: () => db.close() }
}
