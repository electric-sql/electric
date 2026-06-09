import { beforeEach, describe, expect, test, vi } from 'vitest'

const compose = vi.fn()
const getGlobalDispatcher = vi.fn()
const setGlobalDispatcher = vi.fn()
const cacheInterceptor = vi.fn()
const memoryStore = { kind: `memory-store` }
const sqliteStore = { kind: `sqlite-store` }
const MemoryCacheStore = vi.fn(function MemoryCacheStore() {
  return memoryStore
})
const SqliteCacheStore = vi.fn(function SqliteCacheStore() {
  return sqliteStore
})

vi.mock(`undici`, () => ({
  cacheStores: {
    MemoryCacheStore,
    SqliteCacheStore,
  },
  getGlobalDispatcher,
  interceptors: {
    cache: cacheInterceptor,
  },
  setGlobalDispatcher,
}))

describe(`installDurableStreamsFetchCache`, () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    compose.mockReturnValue(`composed-dispatcher`)
    getGlobalDispatcher.mockReturnValue({ compose })
    cacheInterceptor.mockReturnValue(`cache-interceptor`)
  })

  test(`composes cache interceptor on the existing global dispatcher`, async () => {
    const { installDurableStreamsFetchCache } = await import(
      `../src/durable-streams-cache.js`
    )

    installDurableStreamsFetchCache()

    expect(getGlobalDispatcher).toHaveBeenCalledTimes(1)
    expect(cacheInterceptor).toHaveBeenCalledWith({ store: memoryStore })
    expect(compose).toHaveBeenCalledWith(`cache-interceptor`)
    expect(setGlobalDispatcher).toHaveBeenCalledWith(`composed-dispatcher`)
  })

  test(`only installs once even when called multiple times`, async () => {
    const { installDurableStreamsFetchCache } = await import(
      `../src/durable-streams-cache.js`
    )
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    installDurableStreamsFetchCache()
    installDurableStreamsFetchCache()
    installDurableStreamsFetchCache()

    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })
})
