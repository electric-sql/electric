import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StreamClient } from '../src/stream-client'

const {
  appendMock,
  flushMock,
  detachMock,
  headMock,
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

  it(`createSubscription uses the stream-meta subscription contract`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-1` }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(`http://127.0.0.1:4545/v1/stream/tenant-a`)

    try {
      await client.createSubscription(
        `/chat/**`,
        `sub-1`,
        `http://agent.local/webhook`,
        `test subscription`
      )

      expect(fetchMock).toHaveBeenCalledWith(
        `http://127.0.0.1:4545/v1/stream-meta/subscriptions/sub-1?service=tenant-a`,
        expect.objectContaining({ method: `PUT` })
      )
      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toEqual({
        type: `webhook`,
        pattern: `chat/**`,
        webhook: { url: `http://agent.local/webhook` },
        description: `test subscription`,
      })
    } finally {
      fetchMock.mockRestore()
    }
  })
})
