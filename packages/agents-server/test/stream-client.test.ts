import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StreamClient } from '../src/stream-client'

const {
  appendMock,
  flushMock,
  detachMock,
  headMock,
  instanceHeadMock,
  MockFetchError,
  MockDurableStreamError,
} = vi.hoisted(() => {
  class HoistedDurableStreamError extends Error {
    constructor(public code: string) {
      super(code)
      this.name = `DurableStreamError`
    }
  }

  class HoistedFetchError extends Error {
    constructor(public status: number) {
      super(String(status))
      this.name = `FetchError`
    }
  }

  return {
    appendMock: vi.fn(),
    flushMock: vi.fn().mockResolvedValue(undefined),
    detachMock: vi.fn().mockResolvedValue(undefined),
    headMock: vi.fn(),
    instanceHeadMock: vi.fn(),
    MockFetchError: HoistedFetchError,
    MockDurableStreamError: HoistedDurableStreamError,
  }
})

vi.mock(`@durable-streams/client`, () => ({
  DurableStream: class {
    constructor(_opts: { url: string; contentType?: string }) {}

    static create = vi.fn()
    static delete = vi.fn()
    static head = headMock
    head = instanceHeadMock
  },
  DurableStreamError: MockDurableStreamError,
  FetchError: MockFetchError,
  IdempotentProducer: class {
    append = appendMock
    flush = flushMock
    detach = detachMock
  },
  STREAM_OFFSET_HEADER: `Stream-Next-Offset`,
}))

describe(`StreamClient`, () => {
  beforeEach(() => {
    appendMock.mockReset()
    flushMock.mockClear()
    detachMock.mockClear()
    headMock.mockReset()
    instanceHeadMock.mockReset()
    vi.unstubAllGlobals()
  })

  it(`appendIdempotent uses IdempotentProducer append/flush/detach`, async () => {
    const client = new StreamClient(`http://127.0.0.1:4545`)

    await client.appendIdempotent(`/_cron/test`, new Uint8Array([1, 2, 3]), {
      producerId: `scheduler-cron-test-7`,
    })

    expect(appendMock).toHaveBeenCalledTimes(1)
    expect(flushMock).toHaveBeenCalledTimes(1)
    expect(detachMock).toHaveBeenCalledTimes(1)
  })

  it(`exists returns false for missing streams`, async () => {
    headMock.mockRejectedValueOnce(new MockDurableStreamError(`NOT_FOUND`))

    const client = new StreamClient(`http://127.0.0.1:4545`)

    await expect(client.exists(`/_cron/test`)).resolves.toBe(false)
  })

  it(`exists returns false for 404 fetch errors`, async () => {
    headMock.mockRejectedValueOnce(new MockFetchError(404))

    const client = new StreamClient(`http://127.0.0.1:4545`)

    await expect(client.exists(`/_cron/test`)).resolves.toBe(false)
  })

  it(`exists rethrows non-404 backend errors`, async () => {
    const error = new MockDurableStreamError(`BUSY`)
    headMock.mockRejectedValueOnce(error)

    const client = new StreamClient(`http://127.0.0.1:4545`)

    await expect(client.exists(`/_cron/test`)).rejects.toBe(error)
  })

  it(`headOffset returns the stream offset or null for missing streams`, async () => {
    headMock.mockResolvedValueOnce({ exists: true, offset: `17` })
    const client = new StreamClient(`http://127.0.0.1:4545`)

    await expect(client.headOffset(`/_cron/test`)).resolves.toBe(`17`)

    headMock.mockResolvedValueOnce({ exists: false })
    await expect(client.headOffset(`/_cron/missing`)).resolves.toBeNull()

    headMock.mockRejectedValueOnce(new MockFetchError(404))
    await expect(client.headOffset(`/_cron/404`)).resolves.toBeNull()
  })

  it(`mintWakeNotification registers a consumer and builds a wake notification`, async () => {
    instanceHeadMock.mockResolvedValueOnce({ exists: true, offset: `9` })
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal(`fetch`, fetch)
    vi.spyOn(Date, `now`).mockReturnValue(12345)
    vi.spyOn(Math, `random`).mockReturnValue(0.123456789)

    const client = new StreamClient(`http://127.0.0.1:4545`)
    const result = await client.mintWakeNotification(`consumer-1`, {
      streamPath: `/chat/one/main`,
      streams: [{ path: `/chat/one/main`, offset: `9` }],
      triggeredBy: [`append`],
      triggerEvent: `message_received`,
    })

    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:4545/consumers`,
      expect.objectContaining({
        method: `POST`,
        body: JSON.stringify({
          consumer_id: `consumer-1`,
          streams: [`/chat/one/main`],
        }),
      })
    )
    expect(result.notification).toMatchObject({
      consumerId: `consumer-1`,
      epoch: 0,
      wakeId: expect.stringMatching(/^wake-12345-/),
      streamPath: `/chat/one/main`,
      streams: [{ path: `/chat/one/main`, offset: `9` }],
      triggeredBy: [`append`],
      callback: `http://127.0.0.1:4545/consumers/consumer-1/acquire`,
      claimToken: result.notification.wakeId,
      triggerEvent: `message_received`,
    })
  })

  it(`mintWakeNotification fails when the source stream is missing`, async () => {
    instanceHeadMock.mockResolvedValueOnce({ exists: false })
    const client = new StreamClient(`http://127.0.0.1:4545`)

    await expect(
      client.mintWakeNotification(`consumer-1`, { streamPath: `/missing` })
    ).rejects.toThrow(`404 Stream not found`)
  })
})
