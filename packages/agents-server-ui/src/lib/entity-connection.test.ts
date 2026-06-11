import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const preloadMock = vi.fn()
const closeMock = vi.fn()

vi.mock(`./auth-fetch`, () => ({
  serverFetch: fetchMock,
}))

const createEntityStreamDBMock = vi.fn((..._args: Array<unknown>) => ({
  preload: preloadMock,
  close: closeMock,
  collections: {},
}))

vi.mock(`@electric-ax/agents-runtime/client`, () => ({
  appendPathToUrl: (baseUrl: string, path: string) =>
    `${baseUrl.replace(/\/+$/, ``)}${path}`,
  COMMENTS_CONTRACT: `comments/v1`,
  commentsCollection: {
    schema: {},
    type: `state:comments`,
    primaryKey: `key`,
    externallyWritable: true,
    contract: `comments/v1`,
  },
  createEntityStreamDB: createEntityStreamDBMock,
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

  it(`registers the comments collection only when the type advertises the contract`, async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          url: `/horton/abc`,
          externally_writable_collections: {
            comments: { type: `state:comments`, contract: `comments/v1` },
          },
        }),
        { status: 200 }
      )
    )
    preloadMock.mockResolvedValue(undefined)

    const { connectEntityStream } = await import(`./entity-connection`)
    await connectEntityStream({
      baseUrl: `http://server`,
      entityUrl: `/horton/abc`,
    })

    const customState = createEntityStreamDBMock.mock.calls.at(-1)![1] as any
    expect(customState.comments).toMatchObject({ type: `state:comments` })
  })

  it(`registers no comments collection when the type does not declare it`, async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ url: `/worker/abc` }), { status: 200 })
    )
    preloadMock.mockResolvedValue(undefined)

    const { connectEntityStream } = await import(`./entity-connection`)
    await connectEntityStream({
      baseUrl: `http://server`,
      entityUrl: `/worker/abc`,
    })

    const customState = createEntityStreamDBMock.mock.calls.at(-1)![1] as any
    expect(customState.comments).toBeUndefined()
  })
})
