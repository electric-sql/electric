import { Agent, cacheStores, interceptors, setGlobalDispatcher } from 'undici'

const MEMORY_CACHE_SIZE_BYTES = 100 * 1024 * 1024

export type DurableStreamsFetchCacheOptions =
  | false
  | {
      store?: `memory` | `sqlite`
      sqliteLocation?: string
      maxCount?: number
    }

export function installDurableStreamsFetchCache(
  options: DurableStreamsFetchCacheOptions = {}
): void {
  if (options === false) return

  const store =
    options.store === `sqlite` || options.sqliteLocation
      ? new cacheStores.SqliteCacheStore({
          location: options.sqliteLocation,
          maxCount: options.maxCount,
        })
      : new cacheStores.MemoryCacheStore({
          maxSize: MEMORY_CACHE_SIZE_BYTES,
        })

  setGlobalDispatcher(
    new Agent().compose(
      interceptors.cache({
        store,
      })
    )
  )
}
