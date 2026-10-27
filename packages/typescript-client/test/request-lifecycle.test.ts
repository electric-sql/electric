import { FetchError, ShapeStream, type ShapeStreamOptions } from '../src'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const upToDateResponse = () =>
  Response.json([{ headers: { control: `up-to-date` } }], {
    headers: {
      'electric-handle': `test-handle`,
      'electric-offset': `0_0`,
      'electric-schema': `{}`,
      'electric-cursor': `123456`,
      'electric-up-to-date': `true`,
    },
  })

const cleanups: Array<() => void> = []
let nextStreamId = 0

function createStream(options: Partial<ShapeStreamOptions> = {}) {
  const controller = new AbortController()
  const requests: URL[] = []
  const pending = new Map<
    string,
    Set<ReturnType<typeof Promise.withResolvers<Response>>>
  >()
  let maxConcurrent = 0
  const activeRequests = () =>
    [...pending.values()].reduce((sum, set) => sum + set.size, 0)
  const fetchClient: typeof fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const url = input.toString()
    requests.push(new URL(url))
    if (!new URL(url).searchParams.has(`live`)) return upToDateResponse()

    const response = Promise.withResolvers<Response>()
    const requestsAtUrl = pending.get(url) ?? new Set()
    pending.set(url, requestsAtUrl)
    requestsAtUrl.add(response)
    maxConcurrent = Math.max(maxConcurrent, activeRequests())
    const onAbort = () =>
      response.reject(new DOMException(`Aborted`, `AbortError`))
    init?.signal?.addEventListener(`abort`, onAbort, { once: true })
    try {
      return await response.promise
    } finally {
      requestsAtUrl.delete(response)
      init?.signal?.removeEventListener(`abort`, onAbort)
    }
  }
  const stream = new ShapeStream({
    url: `https://example.com/v1/shape/${++nextStreamId}`,
    signal: controller.signal,
    fetchClient,
    backoffOptions: {
      initialDelay: 1,
      maxDelay: 1,
      multiplier: 1,
      maxRetries: 0,
    },
    onError: () => undefined,
    ...options,
  })
  cleanups.push(() => {
    controller.abort()
    stream.unsubscribeAll()
    // Resolve orphaned requests too, so a failing regression cannot leak loops.
    for (const responses of pending.values()) {
      for (const response of responses) response.resolve(upToDateResponse())
    }
  })
  stream.subscribe(() => {})
  return {
    stream,
    requests,
    abort: () => controller.abort(),
    activeRequests,
    maxConcurrent: () => maxConcurrent,
    completeLiveRequests: (result = upToDateResponse()) => {
      for (const responses of pending.values()) {
        for (const response of responses) response.resolve(result.clone())
      }
    },
    completeOneLiveRequest: () => {
      for (const responses of pending.values()) {
        for (const response of responses) {
          response.resolve(upToDateResponse())
          return
        }
      }
    },
    identicalLiveRequests: () =>
      Math.max(0, ...[...pending.values()].map((set) => set.size)),
  }
}

function setHidden(hidden: boolean) {
  vi.spyOn(document, `hidden`, `get`).mockReturnValue(hidden)
  document.dispatchEvent(new Event(`visibilitychange`))
}

const settle = () => vi.advanceTimersByTimeAsync(1)

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, `hidden`, `get`).mockReturnValue(false)
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await settle()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe(`Electric request lifecycle`, () => {
  it(`pauses and resumes an established live request`, async () => {
    const feed = createStream()
    await settle()
    expect(feed.activeRequests()).toBe(1)
    expect(feed.stream.isUpToDate).toBe(true)

    setHidden(true)
    await settle()
    expect(feed.activeRequests()).toBe(0)

    setHidden(false)
    await settle()
    expect(feed.activeRequests()).toBe(1)
    expect(feed.maxConcurrent()).toBe(1)
  })

  it(`resumes a live request when the tab is shown before its abort settles`, async () => {
    const feed = createStream()
    await settle()

    setHidden(true)
    setHidden(false)
    await settle()

    expect(feed.activeRequests()).toBe(1)
    expect(feed.maxConcurrent()).toBe(1)
  })

  it(`keeps one live loop across repeated visibility changes while auth is pending`, async () => {
    let token: Promise<string> = Promise.resolve(`Bearer token`)
    const feed = createStream({ headers: { Authorization: () => token } })
    await settle()
    expect(feed.activeRequests()).toBe(1)

    const refreshedToken = Promise.withResolvers<string>()
    token = refreshedToken.promise
    feed.completeLiveRequests()
    await settle()
    expect(feed.activeRequests()).toBe(0)

    for (let i = 0; i < 3; i++) {
      setHidden(true)
      setHidden(false)
    }
    refreshedToken.resolve(`Bearer refreshed-token`)
    await settle()

    expect(feed.identicalLiveRequests()).toBe(1)
    expect(feed.maxConcurrent()).toBe(1)

    feed.completeOneLiveRequest()
    await settle()
    expect(feed.activeRequests()).toBe(1)
    setHidden(true)
    await settle()
    expect(feed.activeRequests()).toBe(0)
  })

  it(`keeps one live loop when visibility changes during a 401 retry`, async () => {
    const retry = Promise.withResolvers<Record<string, never>>()
    const onError = vi.fn(async (error: unknown) => {
      expect(error).toBeInstanceOf(FetchError)
      expect((error as FetchError).status).toBe(401)
      return retry.promise
    })
    const feed = createStream({ onError })
    await settle()
    expect(feed.activeRequests()).toBe(1)
    feed.completeLiveRequests(
      Response.json({ error: `Unauthorized` }, { status: 401 })
    )
    await settle()
    expect(feed.activeRequests()).toBe(0)
    expect(onError).toHaveBeenCalledTimes(1)

    setHidden(true)
    setHidden(false)
    await settle()
    retry.resolve({})
    await settle()

    expect(feed.identicalLiveRequests()).toBe(1)
    expect(feed.maxConcurrent()).toBe(1)
  })

  it(`waits for visibility when a 401 retry completes while the tab is hidden`, async () => {
    const retry = Promise.withResolvers<Record<string, never>>()
    const feed = createStream({ onError: () => retry.promise })
    await settle()
    feed.completeLiveRequests(Response.json({}, { status: 401 }))
    await settle()

    setHidden(true)
    retry.resolve({})
    await settle()
    expect(feed.activeRequests()).toBe(0)

    setHidden(false)
    await settle()
    expect(feed.activeRequests()).toBe(1)
    expect(feed.stream.lastOffset).toBe(`0_0`)
    expect(feed.requests.at(-2)?.searchParams.has(`live`)).toBe(false)
    expect(feed.maxConcurrent()).toBe(1)
  })

  it(`rebuilds a catch-up request when visibility changes during auth resolution`, async () => {
    let token = Promise.resolve(`Bearer token`)
    const feed = createStream({ headers: { Authorization: () => token } })
    await settle()
    const refreshedToken = Promise.withResolvers<string>()
    token = refreshedToken.promise
    feed.completeLiveRequests()
    await settle()

    setHidden(true)
    setHidden(false)
    refreshedToken.resolve(`Bearer refreshed`)
    await settle()

    expect(feed.requests.at(-2)?.searchParams.get(`offset`)).toBe(`0_0`)
    expect(feed.requests.at(-2)?.searchParams.has(`live`)).toBe(false)
    expect(feed.activeRequests()).toBe(1)
  })

  it(`does not start a resumed request after the stream is aborted during auth`, async () => {
    const token = Promise.withResolvers<string>()
    const feed = createStream({
      headers: { Authorization: () => token.promise },
    })
    await settle()
    setHidden(true)
    setHidden(false)
    feed.abort()
    token.resolve(`Bearer token`)
    await settle()

    expect(feed.requests).toHaveLength(0)
    expect(feed.activeRequests()).toBe(0)
  })

  it(`does not restart a terminal error when visibility changes during its handler`, async () => {
    const result = Promise.withResolvers<void>()
    const onError = vi.fn(() => result.promise)
    const feed = createStream({ onError })
    await settle()
    feed.completeLiveRequests(Response.json({}, { status: 403 }))
    await settle()
    setHidden(true)
    setHidden(false)
    result.resolve()
    await settle()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(feed.requests).toHaveLength(2)
    expect(feed.activeRequests()).toBe(0)
  })

  it(`keeps one loop when a subset snapshot and visibility changes overlap`, async () => {
    const feed = createStream({ log: `changes_only` })
    await settle()
    const snapshot =
      Promise.withResolvers<
        Awaited<ReturnType<typeof feed.stream.fetchSnapshot>>
      >()
    vi.spyOn(feed.stream, `fetchSnapshot`).mockReturnValue(snapshot.promise)
    const snapshotRequest = feed.stream.requestSnapshot({ where: `id = 1` })
    setHidden(true)
    setHidden(false)
    await settle()
    expect(feed.activeRequests()).toBe(0)

    snapshot.resolve({
      metadata: {
        snapshot_mark: 1,
        xmin: `1`,
        xmax: `2`,
        xip_list: [],
        database_lsn: `1`,
      },
      data: [],
      responseOffset: null,
      responseHandle: null,
    })
    await snapshotRequest
    await settle()

    expect(feed.activeRequests()).toBe(1)
    expect(feed.maxConcurrent()).toBe(1)
  })

  it(`refreshes an established stream without starting another loop`, async () => {
    const feed = createStream()
    await settle()
    const refresh = feed.stream.forceDisconnectAndRefresh()
    await settle()
    await refresh

    expect(feed.activeRequests()).toBe(1)
    expect(feed.stream.lastOffset).toBe(`0_0`)
    expect(feed.maxConcurrent()).toBe(1)
  })

  it(`keeps one loop when a snapshot resumes during auth resolution`, async () => {
    const token = Promise.withResolvers<string>()
    let blockNextHeader = false
    const feed = createStream({
      log: `changes_only`,
      headers: {
        Authorization: () => {
          if (blockNextHeader) {
            blockNextHeader = false
            return token.promise
          }
          return `Bearer token`
        },
      },
    })
    await settle()
    blockNextHeader = true
    feed.completeLiveRequests()
    await settle()
    vi.spyOn(feed.stream, `fetchSnapshot`).mockResolvedValue({
      metadata: {
        snapshot_mark: 1,
        xmin: `1`,
        xmax: `2`,
        xip_list: [],
        database_lsn: `1`,
      },
      data: [],
      responseOffset: null,
      responseHandle: null,
    })
    await feed.stream.requestSnapshot({ where: `id = 1` })
    token.resolve(`Bearer refreshed`)
    await settle()

    expect(feed.activeRequests()).toBe(1)
    expect(feed.maxConcurrent()).toBe(1)
  })
  it(`does not restart a completed one-shot stream after a snapshot`, async () => {
    const feed = createStream({ log: `changes_only`, subscribe: false })
    await settle()
    let reads = 0
    Object.defineProperty(feed.stream.options, `subscribe`, {
      get: () => {
        // Stop a regression from spinning forever in microtasks and starving the test timeout.
        if (++reads > 10) feed.abort()
        return false
      },
    })
    vi.spyOn(feed.stream, `fetchSnapshot`).mockResolvedValue({
      metadata: {
        snapshot_mark: 1,
        xmin: `1`,
        xmax: `2`,
        xip_list: [],
        database_lsn: `1`,
      },
      data: [],
      responseOffset: null,
      responseHandle: null,
    })
    await feed.stream.requestSnapshot({ where: `id = 1` })
    await settle()

    expect(feed.stream.options.signal?.aborted).toBe(false)
    expect(feed.requests).toHaveLength(1)
    expect(feed.activeRequests()).toBe(0)
  })
})
