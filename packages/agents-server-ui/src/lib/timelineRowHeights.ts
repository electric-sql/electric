const CACHE_KEY = `electric-agents-ui:timeline-row-heights:v1`
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_CACHED_ENTITIES = 50
const MAX_ROWS_PER_ENTITY = 1000
const WIDTH_TOLERANCE_PX = 16

interface PersistedRowHeight {
  size: number
  width: number
  updatedAt: number
}

interface PersistedEntityRowHeights {
  updatedAt: number
  rows: Record<string, PersistedRowHeight>
}

type PersistedCache = Partial<Record<string, PersistedEntityRowHeights>>

let memoryCache: PersistedCache | null = null

function canUseStorage(): boolean {
  return (
    typeof window !== `undefined` && typeof window.localStorage !== `undefined`
  )
}

function pruneCache(cache: PersistedCache, now = Date.now()): PersistedCache {
  const liveEntries = Object.entries(cache)
    .filter(
      (entry): entry is [string, PersistedEntityRowHeights] =>
        entry[1] !== undefined
    )
    .map(([entityKey, entityCache]) => {
      const rows = Object.fromEntries(
        Object.entries(entityCache.rows)
          .filter(([, row]) => now - row.updatedAt <= MAX_CACHE_AGE_MS)
          .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
          .slice(0, MAX_ROWS_PER_ENTITY)
      )

      const updatedAt = Object.values(rows).reduce(
        (latest, row) => Math.max(latest, row.updatedAt),
        entityCache.updatedAt
      )

      return [entityKey, { updatedAt, rows }] as const
    })
    .filter(([, entityCache]) => Object.keys(entityCache.rows).length > 0)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CACHED_ENTITIES)

  return Object.fromEntries(liveEntries)
}

function readCache(): PersistedCache {
  if (memoryCache) return memoryCache
  if (!canUseStorage()) return {}

  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) {
      memoryCache = {}
      return memoryCache
    }

    const parsed = JSON.parse(raw) as PersistedCache
    memoryCache = pruneCache(parsed)
    return memoryCache
  } catch {
    memoryCache = {}
    return memoryCache
  }
}

function writeCache(cache: PersistedCache): void {
  memoryCache = pruneCache(cache)
  if (!canUseStorage()) return

  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache))
  } catch {
    // Ignore storage quota / privacy-mode failures. The in-memory copy still helps.
  }
}

export function loadTimelineRowHeights(
  entityKey: string,
  viewportWidth: number
): Map<string, number> {
  if (!entityKey || viewportWidth <= 0) return new Map()

  const cache = readCache()[entityKey]
  if (!cache) return new Map()

  const rows = new Map<string, number>()
  for (const [rowKey, row] of Object.entries(cache.rows)) {
    if (
      Math.abs(row.width - viewportWidth) <= WIDTH_TOLERANCE_PX &&
      row.size > 0
    ) {
      rows.set(rowKey, row.size)
    }
  }

  return rows
}

export function persistTimelineRowHeights(
  entityKey: string,
  viewportWidth: number,
  heights: Map<string, number>,
  settledKeys: Iterable<string>
): void {
  if (!entityKey || viewportWidth <= 0) return

  const cache = readCache()
  const now = Date.now()
  const existing = cache[entityKey]
  const rows: Record<string, PersistedRowHeight> = {
    ...(existing?.rows ?? {}),
  }

  for (const rowKey of settledKeys) {
    const size = heights.get(rowKey)
    if (!size || size <= 0) continue
    rows[rowKey] = {
      size,
      width: viewportWidth,
      updatedAt: now,
    }
  }

  cache[entityKey] = {
    updatedAt: now,
    rows,
  }
  writeCache(cache)
}
