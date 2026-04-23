const DB_NAME = `electric-agents-ui-markdown-render-cache`
const STORE_NAME = `segments`
const DB_VERSION = 2
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 2000
const WIDTH_TOLERANCE_PX = 16
const WRITE_FLUSH_MS = 150
const PRUNE_FLUSH_MS = 1000

export interface CachedMarkdownRender {
  html: string
  height: number
  sourceText: string
  width: number
  updatedAt: number
}

interface PersistedMarkdownRender extends CachedMarkdownRender {
  cacheKey: string
  hash: number
}

let memoryCache = new Map<number, Array<PersistedMarkdownRender>>()
let cacheReady = false
let warmPromise: Promise<void> | null = null
let pendingWrites = new Map<string, PersistedMarkdownRender>()
let writeFlushTimer: ReturnType<typeof setTimeout> | null = null
let pruneTimer: ReturnType<typeof setTimeout> | null = null
let persistenceQueue: Promise<void> = Promise.resolve()

function logMarkdownRenderCacheError(context: string, error: unknown): void {
  console.error(`[markdownRenderCache] ${context}`, error)
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== `undefined`
}

function cacheKey(hash: number, width: number): string {
  return `${hash}:${width}`
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null)

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: `cacheKey` })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      logMarkdownRenderCacheError(`failed to open database`, request.error)
      resolve(null)
    }
    request.onblocked = () => {
      logMarkdownRenderCacheError(
        `database open blocked`,
        new Error(`indexedDB open request was blocked`)
      )
      resolve(null)
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionToPromise(
  tx: IDBTransaction,
  context: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(tx.error ?? new Error(`${context} transaction failed`))
    tx.onabort = () =>
      reject(tx.error ?? new Error(`${context} transaction aborted`))
  })
}

function enqueuePersistenceWork(task: () => Promise<void>): void {
  persistenceQueue = persistenceQueue
    .catch((error) => {
      logMarkdownRenderCacheError(`previous persistence task failed`, error)
    })
    .then(task)
    .catch((error) => {
      logMarkdownRenderCacheError(`persistence task failed`, error)
    })
}

function remember(entry: PersistedMarkdownRender): void {
  const existing = memoryCache.get(entry.hash) ?? []
  const next = [
    entry,
    ...existing.filter((candidate) => candidate.cacheKey !== entry.cacheKey),
  ]
  next.sort((left, right) => right.updatedAt - left.updatedAt)
  memoryCache.set(entry.hash, next)
}

function pruneMemoryCache(now = Date.now()): Array<PersistedMarkdownRender> {
  const liveEntries = Array.from(memoryCache.values())
    .flat()
    .filter((entry) => now - entry.updatedAt <= MAX_CACHE_AGE_MS)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_ENTRIES)

  memoryCache = new Map()
  for (const entry of liveEntries) {
    remember(entry)
  }

  return liveEntries
}

async function rewriteDatabase(
  entries: Array<PersistedMarkdownRender>
): Promise<void> {
  const db = await openDatabase()
  if (!db) return

  try {
    const tx = db.transaction(STORE_NAME, `readwrite`)
    const store = tx.objectStore(STORE_NAME)
    await requestToPromise(store.clear())
    for (const entry of entries) {
      store.put(entry)
    }
    await transactionToPromise(tx, `rewrite cache`)
  } finally {
    db.close()
  }
}

async function prunePersistentCache(): Promise<void> {
  const entries = pruneMemoryCache()
  await rewriteDatabase(entries)
}

function schedulePrunePersistentCache(): void {
  if (pruneTimer !== null) return

  pruneTimer = setTimeout(() => {
    pruneTimer = null
    enqueuePersistenceWork(prunePersistentCache)
  }, PRUNE_FLUSH_MS)
}

async function flushPendingWrites(): Promise<void> {
  if (pendingWrites.size === 0) return

  const entries = Array.from(pendingWrites.values())
  pendingWrites = new Map()

  const db = await openDatabase()
  if (!db) return

  try {
    const tx = db.transaction(STORE_NAME, `readwrite`)
    const store = tx.objectStore(STORE_NAME)

    for (const entry of entries) {
      store.put(entry)
    }

    await transactionToPromise(tx, `flush pending writes`)
  } finally {
    db.close()
  }

  const entryCount = Array.from(memoryCache.values()).reduce(
    (total, list) => total + list.length,
    0
  )
  if (entryCount > MAX_ENTRIES) {
    schedulePrunePersistentCache()
  }
}

function scheduleFlushPendingWrites(): void {
  if (writeFlushTimer !== null) return

  writeFlushTimer = setTimeout(() => {
    writeFlushTimer = null
    enqueuePersistenceWork(flushPendingWrites)
  }, WRITE_FLUSH_MS)
}

export function hashMarkdownContent(text: string): number {
  let hash = 5381
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return hash >>> 0
}

export function getCachedMarkdownRender(
  hash: number,
  width: number,
  sourceText: string
): CachedMarkdownRender | null {
  if (width <= 0) return null

  const candidates = memoryCache.get(hash)
  if (!candidates || candidates.length === 0) return null

  let best: PersistedMarkdownRender | null = null
  for (const candidate of candidates) {
    if (candidate.sourceText !== sourceText) continue
    if (Math.abs(candidate.width - width) > WIDTH_TOLERANCE_PX) continue
    if (
      best === null ||
      Math.abs(candidate.width - width) < Math.abs(best.width - width) ||
      candidate.updatedAt > best.updatedAt
    ) {
      best = candidate
    }
  }

  return best
    ? {
        html: best.html,
        height: best.height,
        sourceText: best.sourceText,
        width: best.width,
        updatedAt: best.updatedAt,
      }
    : null
}

export function isMarkdownRenderCacheReady(): boolean {
  return cacheReady
}

export function warmMarkdownRenderCache(): Promise<void> {
  if (cacheReady) return Promise.resolve()
  if (warmPromise) return warmPromise

  warmPromise = (async () => {
    if (!canUseIndexedDb()) {
      cacheReady = true
      return
    }

    try {
      const db = await openDatabase()
      if (!db) {
        cacheReady = true
        return
      }

      const tx = db.transaction(STORE_NAME, `readonly`)
      const store = tx.objectStore(STORE_NAME)
      const entries = (await requestToPromise(
        store.getAll()
      )) as Array<PersistedMarkdownRender>

      memoryCache = new Map()
      const now = Date.now()
      for (const entry of entries) {
        if (now - entry.updatedAt > MAX_CACHE_AGE_MS) continue
        remember(entry)
      }

      db.close()
      if (entries.length > MAX_ENTRIES) {
        schedulePrunePersistentCache()
      }
    } catch (error) {
      logMarkdownRenderCacheError(`failed to warm cache`, error)
      memoryCache = new Map()
    } finally {
      cacheReady = true
    }
  })()

  return warmPromise
}

export function setCachedMarkdownRender(
  hash: number,
  value: { html: string; height: number; sourceText: string; width: number }
): void {
  if (
    value.width <= 0 ||
    value.height <= 0 ||
    value.html.length === 0 ||
    value.sourceText.length === 0
  ) {
    return
  }

  const entry: PersistedMarkdownRender = {
    cacheKey: cacheKey(hash, value.width),
    hash,
    html: value.html,
    height: value.height,
    sourceText: value.sourceText,
    width: value.width,
    updatedAt: Date.now(),
  }

  const existing = memoryCache
    .get(hash)
    ?.find((candidate) => candidate.cacheKey === entry.cacheKey)
  if (
    existing &&
    existing.html === entry.html &&
    existing.height === entry.height &&
    existing.sourceText === entry.sourceText &&
    existing.width === entry.width
  ) {
    return
  }

  remember(entry)
  pendingWrites.set(entry.cacheKey, entry)
  scheduleFlushPendingWrites()
}
