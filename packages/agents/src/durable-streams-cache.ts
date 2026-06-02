import { Agent, cacheStores, interceptors, setGlobalDispatcher } from 'undici'

const CACHE_SIZE_BYTES = 100 * 1024 * 1024

export function installDurableStreamsFetchCache(): void {
  setGlobalDispatcher(
    new Agent().compose(
      interceptors.cache({
        store: new cacheStores.MemoryCacheStore({
          maxSize: CACHE_SIZE_BYTES,
        }),
      })
    )
  )
}
