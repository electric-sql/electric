import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const preloadMock = vi.fn()
const closeMock = vi.fn()

vi.mock(`./auth-fetch`, () => ({
  serverFetch: fetchMock,
}))

vi.mock(`@electric-ax/agents-runtime/client`, () => ({
  appendPathToUrl: (baseUrl: string, path: string) =>
    `${baseUrl.replace(/\/+$/, ``)}${path}`,
  commentsCollection: {
    schema: {},
    type: `state:comments`,
    primaryKey: `key`,
    externallyWritable: { principalColumn: `_principal` },
  },
  createEntityStreamDB: vi.fn(() => ({
    preload: preloadMock,
    close: closeMock,
    collections: {},
  })),
}))

describe(`connectEntityStream`, () => {
  afterEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useRealTimers()
    const mod = await import(`./entity-connection`)
    mod.__clearEntityConnectionCacheForTests()
  })

  it(`retries bare entity metadata 404s to tolerate post-spawn navigation races`, async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(new Response(`not yet`, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: `/horton/abc` }), { status: 200 })
      )
    preloadMock.mockResolvedValue(undefined)

    const { connectEntityStream } = await import(`./entity-connection`)
    const promise = connectEntityStream({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
    })

    await vi.advanceTimersByTimeAsync(250)
    const connection = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `http://server/_electric/entities/horton/abc`,
      expect.objectContaining({ headers: { accept: `application/json` } })
    )
    expect(connection.db).toBeTruthy()
  })
})
