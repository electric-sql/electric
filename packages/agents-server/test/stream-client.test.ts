import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StreamClient } from '../src/stream-client'
import type { DurableStreamsRoutingAdapter } from '../src/routing/durable-streams-routing-adapter'

function servicePrefixRoutingAdapter(): DurableStreamsRoutingAdapter {
  return {
    streamUrl: ({ durableStreamsUrl }) => new URL(durableStreamsUrl),
    controlUrl: ({ durableStreamsUrl }) => new URL(durableStreamsUrl),
    toBackendStreamPath: (serviceId, path) => {
      const normalized = path.replace(/^\/+/, ``)
      if (normalized === serviceId || normalized.startsWith(`${serviceId}/`)) {
        return normalized
      }
      return `${serviceId}/${normalized}`
    },
    toRuntimeStreamPath: (serviceId, path) => {
      const normalized = path.replace(/^\/+/, ``)
      return normalized.startsWith(`${serviceId}/`)
        ? normalized.slice(serviceId.length + 1)
        : normalized
    },
  }
}

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

  it(`createSubscription appends reserved __ds control paths to the opaque backend URL`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-1` }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(
      `http://127.0.0.1:4545/custom/ds-prefix?tenant=tenant-a`
    )

    try {
      await client.createSubscription(
        `/chat/**`,
        `sub-1`,
        `http://agent.local/webhook`,
        `test subscription`
      )

      expect(fetchMock).toHaveBeenCalledWith(
        `http://127.0.0.1:4545/custom/ds-prefix/__ds/subscriptions/sub-1?tenant=tenant-a`,
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

  it(`does not tenant-prefix subscription streams for tenant-root URLs`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-1` }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(
      `https://streams.test/v1/streams/svc-tenant-a`
    )

    try {
      await client.putSubscription(`sub-1`, {
        type: `pull-wake`,
        streams: [`/chat/one/main`],
        wake_stream: `/runners/runner-1/wake`,
      })

      expect(fetchMock).toHaveBeenCalledWith(
        `https://streams.test/v1/streams/svc-tenant-a/__ds/subscriptions/sub-1`,
        expect.objectContaining({ method: `PUT` })
      )
      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toMatchObject({
        streams: [`chat/one/main`],
        wake_stream: `runners/runner-1/wake`,
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`sends configured durable streams bearer auth on subscription requests`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-1` }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(
      `http://127.0.0.1:4545/v1/stream/tenant-a`,
      { bearer: `service-token` }
    )

    try {
      await client.putSubscription(`sub-1`, {
        type: `pull-wake`,
        streams: [`/chat/one/main`],
        wake_stream: `/runners/runner-1/wake`,
      })

      const [, init] = fetchMock.mock.calls[0]!
      const headers = new Headers(init?.headers)
      expect(headers.get(`authorization`)).toBe(`Bearer service-token`)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`resolves durable streams bearer functions per request`, async () => {
    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ subscription_id: `sub-1` }), {
          headers: { 'content-type': `application/json` },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ subscription_id: `sub-1` }), {
          headers: { 'content-type': `application/json` },
        })
      )
    let token = 0
    const client = new StreamClient(
      `http://127.0.0.1:4545/v1/stream/tenant-a`,
      { bearer: () => `service-token-${++token}` }
    )

    try {
      await client.getSubscription(`sub-1`)
      await client.claimSubscription(`sub-1`, `runner-1`)

      expect(
        new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(`authorization`)
      ).toBe(`Bearer service-token-1`)
      expect(
        new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get(`authorization`)
      ).toBe(`Bearer service-token-2`)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`service-prefixes subscription paths via the routing adapter on putSubscription`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          subscription_id: `sub-1`,
          pattern: `svc-tenant-a/discord-bot/abc/main`,
          streams: [
            { path: `svc-tenant-a/discord-bot/abc/main`, tail_offset: `0` },
          ],
          wake_stream: `svc-tenant-a/runners/runner-1/wake`,
        }),
        { headers: { 'content-type': `application/json` } }
      )
    )
    const client = new StreamClient(
      `https://streams.test/v1/stream/svc-tenant-a`,
      {
        routing: {
          serviceId: `svc-tenant-a`,
          adapter: servicePrefixRoutingAdapter(),
        },
      }
    )

    try {
      const response = await client.putSubscription(`sub-1`, {
        type: `webhook`,
        streams: [`/discord-bot/abc/main`],
        webhook: { url: `http://agent.local/webhook` },
        wake_stream: `/runners/runner-1/wake`,
      })

      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toMatchObject({
        type: `webhook`,
        streams: [`svc-tenant-a/discord-bot/abc/main`],
        webhook: { url: `http://agent.local/webhook` },
        wake_stream: `svc-tenant-a/runners/runner-1/wake`,
      })

      // Response paths are stripped back to the logical (runtime) namespace.
      expect(response.pattern).toBe(`discord-bot/abc/main`)
      expect(response.wake_stream).toBe(`runners/runner-1/wake`)
      expect(response.streams).toEqual([
        { path: `discord-bot/abc/main`, tail_offset: `0` },
      ])
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`service-prefixes subscription paths on addSubscriptionStreams`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-1` }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(
      `https://streams.test/v1/stream/svc-tenant-a`,
      {
        routing: {
          serviceId: `svc-tenant-a`,
          adapter: servicePrefixRoutingAdapter(),
        },
      }
    )

    try {
      await client.addSubscriptionStreams(`sub-1`, [
        `/discord-bot/abc/main`,
        `/discord-bot/def/main`,
      ])

      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toEqual({
        streams: [
          `svc-tenant-a/discord-bot/abc/main`,
          `svc-tenant-a/discord-bot/def/main`,
        ],
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`service-prefixes ack stream/path fields via the routing adapter`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(
      `https://streams.test/v1/stream/svc-tenant-a`,
      {
        bearer: `service-token`,
        routing: {
          serviceId: `svc-tenant-a`,
          adapter: servicePrefixRoutingAdapter(),
        },
      }
    )

    try {
      await client.ackSubscription(`sub-1`, `claim-token`, {
        wake_id: `wake-1`,
        generation: 1,
        acks: [
          { stream: `/discord-bot/abc/main`, offset: `5` },
          { path: `/discord-bot/def/main`, offset: `6` },
        ],
      })

      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toMatchObject({
        acks: [
          { stream: `svc-tenant-a/discord-bot/abc/main`, offset: `5` },
          { path: `svc-tenant-a/discord-bot/def/main`, offset: `6` },
        ],
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`leaves already-prefixed subscription paths idempotent`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-1` }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(
      `https://streams.test/v1/stream/svc-tenant-a`,
      {
        routing: {
          serviceId: `svc-tenant-a`,
          adapter: servicePrefixRoutingAdapter(),
        },
      }
    )

    try {
      await client.putSubscription(`sub-1`, {
        type: `webhook`,
        streams: [`svc-tenant-a/discord-bot/abc/main`],
        webhook: { url: `http://agent.local/webhook` },
      })

      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toMatchObject({
        streams: [`svc-tenant-a/discord-bot/abc/main`],
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`preserves claim token authorization on subscription ack`, async () => {
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const client = new StreamClient(
      `http://127.0.0.1:4545/v1/stream/tenant-a`,
      { bearer: `service-token` }
    )

    try {
      await client.ackSubscription(`sub-1`, `claim-token`, {
        wake_id: `wake-1`,
        generation: 1,
      })

      const [, init] = fetchMock.mock.calls[0]!
      const headers = new Headers(init?.headers)
      expect(headers.get(`authorization`)).toBe(`Bearer claim-token`)
    } finally {
      fetchMock.mockRestore()
    }
  })
})
