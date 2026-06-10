import {
  cacheStores,
  getGlobalDispatcher,
  interceptors,
  setGlobalDispatcher,
} from 'undici'

const MEMORY_CACHE_SIZE_BYTES = 100 * 1024 * 1024

let installed = false

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
  if (installed) {
    console.warn(
      `[agents] installDurableStreamsFetchCache called more than once; ignoring`
    )
    return
  }
  const store =
    options.store === `sqlite` || options.sqliteLocation
      ? new cacheStores.SqliteCacheStore({
          location: options.sqliteLocation,
          maxCount: options.maxCount,
        })
      : new cacheStores.MemoryCacheStore({
          maxSize: MEMORY_CACHE_SIZE_BYTES,
        })

  // Compose on top of the current global dispatcher instead of replacing it.
  // Electric Agents Desktop installs its Cloud auth injector as a global
  // dispatcher interceptor before starting the built-in agents runtime; using a
  // fresh Agent() here drops that auth injector and Cloud requests start
  // failing with 401 Missing bearer token.
  setGlobalDispatcher(
    getGlobalDispatcher().compose(
      interceptors.cache({
        store,
      })
    )
  )

  installed = true
}
