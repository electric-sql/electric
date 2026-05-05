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

// ---------------------------------------------------------------------------
// Module-level active base URL
// Registered by useServerConnection so the route loader (outside React)
// can call connectEntityStream without needing context.
// ---------------------------------------------------------------------------

let _activeBaseUrl: string | null = null

export function registerActiveBaseUrl(url: string | null): void {
  _activeBaseUrl = url
}

export function getActiveBaseUrl(): string | null {
  return _activeBaseUrl
}

// ---------------------------------------------------------------------------
// Connection cache
// Keyed by `${baseUrl}${entityUrl}`. The route loader and useEntityTimeline
// share the same promise so preload() only runs once.
// ---------------------------------------------------------------------------

type CachedConnection = {
  promise: Promise<{ db: EntityStreamDBWithActions; close: () => void }>
}

const connectionCache = new Map<string, CachedConnection>()

function cacheKey(baseUrl: string, entityUrl: string): string {
  return `${baseUrl}${entityUrl}`
}

/**
 * Connect to an entity stream, returning a shared promise.
 * Multiple callers with the same baseUrl+entityUrl get the same db instance.
 * On failure the cache entry is evicted so a subsequent call retries fresh.
 */
export function connectEntityStream(opts: {
  baseUrl: string
  entityUrl: string
  customState?: UICustomState
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const { baseUrl, entityUrl, customState } = opts
  const key = cacheKey(baseUrl, entityUrl)

  const existing = connectionCache.get(key)
  if (existing) return existing.promise

  const promise = connectEntityStreamFresh({ baseUrl, entityUrl, customState })

  const entry: CachedConnection = { promise }
  connectionCache.set(key, entry)

  // Evict on error so the next attempt starts fresh.
  promise.catch(() => {
    if (connectionCache.get(key) === entry) connectionCache.delete(key)
  })

  return promise
}

/**
 * Evict the cached connection for an entity, closing the db.
 * Call this when the component displaying the entity unmounts.
 */
export function closeEntityStream(opts: {
  baseUrl: string
  entityUrl: string
}): void {
  const key = cacheKey(opts.baseUrl, opts.entityUrl)
  const entry = connectionCache.get(key)
  if (!entry) return
  connectionCache.delete(key)
  entry.promise
    .then(({ close }) => close())
    .catch(() => {
      /* already evicted on error */
    })
}

async function connectEntityStreamFresh(opts: {
  baseUrl: string
  entityUrl: string
  customState?: UICustomState
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const { baseUrl, entityUrl, customState } = opts

  const res = await fetch(`${baseUrl}${entityUrl}`, {
    headers: { accept: `application/json` },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch entity at ${entityUrl}: ${res.statusText}`)
  }
  await res.body?.cancel()
  const streamUrl = `${baseUrl}${getMainStreamPath(entityUrl)}`
  const db = createEntityStreamDB(
    streamUrl,
    customState as unknown as Parameters<typeof createEntityStreamDB>[1]
  )
  await db.preload()

  return { db, close: () => db.close() }
}
