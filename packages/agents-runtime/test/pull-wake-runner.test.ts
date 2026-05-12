import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPullWakeRunner } from '../src/pull-wake-runner'
import type { PullWakeEvent } from '../src/pull-wake-runner'
import type { WakeNotification } from '../src/types'

const durableStreamMocks = vi.hoisted(() => {
  const stream = vi.fn()
  const DurableStream = vi.fn(function (_opts: unknown) {
    return { stream }
  })
  return { DurableStream, stream }
})

vi.mock(`@durable-streams/client`, () => ({
  DurableStream: durableStreamMocks.DurableStream,
}))

describe(`createPullWakeRunner`, () => {
  afterEach(() => {
    durableStreamMocks.DurableStream.mockClear()
    durableStreamMocks.stream.mockReset()
    vi.unstubAllGlobals()
  })

  it(`claims compact DS wake events before dispatching runtime wakes`, async () => {
    const event: PullWakeEvent = {
      type: `wake`,
      subscription_id: `runner:runner-1`,
      stream: `chat/one/main`,
      generation: 7,
      ts: 123,
    }
    const notification: WakeNotification = {
      consumerId: `wake-1`,
      epoch: 7,
      wakeId: `wake-1`,
      streamPath: `/chat/one/main`,
      streams: [{ path: `/chat/one/main`, offset: `12` }],
      callback: `http://server/_electric/callback-forward/wake-1`,
      claimToken: `claim-token`,
      entity: {
        type: `chat`,
        status: `idle`,
        url: `/chat/one`,
        streams: { main: `/chat/one/main`, error: `/chat/one/error` },
      },
    }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json(notification)
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const dispatchWake = vi.fn()
    const drainWakes = vi.fn(async () => undefined)
    const streamFactory = vi.fn(async () => ({
      offset: `42`,
      async *jsonStream() {
        yield event
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: {
        dispatchWake,
        drainWakes,
        abortWakes: vi.fn(),
      },
      headers: { 'x-electric-asserted-email': `owner@example.com` },
      claimHeaders: { authorization: `Bearer session-token` },
      claimTokenHeader: `electric-claim-token`,
      heartbeatIntervalMs: 0,
      streamFactory,
    })

    runner.start()
    await runner.waitForStopped()

    expect(streamFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `http://server/runners/runner-1/wake`,
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `http://server/_electric/runners/runner-1/claim`,
      expect.objectContaining({
        method: `POST`,
        body: JSON.stringify(event),
      })
    )
    expect(dispatchWake).toHaveBeenCalledWith(notification, {
      claimHeaders: expect.any(Function),
      claimTokenHeader: `electric-claim-token`,
    })
    expect(drainWakes).toHaveBeenCalledTimes(1)
    expect(runner.offset).toBe(`42`)
  })

  it(`skips stale wake events when claim returns no pending work`, async () => {
    const event: PullWakeEvent = {
      type: `wake`,
      subscription_id: `runner:runner-1`,
      stream: `chat/one/main`,
      generation: 7,
      ts: 123,
    }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json(
        {
          error: {
            code: `NO_PENDING_WORK`,
            message: `Subscription has no pending work`,
          },
        },
        { status: 409 }
      )
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const dispatchWake = vi.fn()
    const drainWakes = vi.fn(async () => undefined)
    const onError = vi.fn()
    const streamFactory = vi.fn(async () => ({
      offset: `42`,
      async *jsonStream() {
        yield event
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: {
        dispatchWake,
        drainWakes,
        abortWakes: vi.fn(),
      },
      headers: { 'x-electric-asserted-email': `owner@example.com` },
      heartbeatIntervalMs: 0,
      streamFactory,
      onError,
    })

    runner.start()
    await runner.waitForStopped()

    expect(fetchMock).toHaveBeenCalled()
    expect(dispatchWake).not.toHaveBeenCalled()
    expect(drainWakes).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(runner.offset).toBe(`42`)
  })

  it(`preserves base URL query parameters on stream, claim, and heartbeat requests`, async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal(`fetch`, fetchMock)
    const streamFactory = vi.fn(async () => ({
      offset: `42`,
      async *jsonStream() {
        yield {
          type: `wake`,
          subscription_id: `runner:runner-1`,
          stream: `chat/one/main`,
          generation: 7,
        } satisfies PullWakeEvent
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server/root?secret=s1`,
      runnerId: `runner-1`,
      runtime: {
        dispatchWake: vi.fn(),
        drainWakes: vi.fn(),
        abortWakes: vi.fn(),
      },
      heartbeatIntervalMs: 1,
      streamFactory,
    })

    runner.start()
    await runner.waitForStopped()

    expect(streamFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `http://server/root/runners/runner-1/wake?secret=s1`,
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `http://server/root/_electric/runners/runner-1/heartbeat?secret=s1`,
      expect.any(Object)
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `http://server/root/_electric/runners/runner-1/claim?secret=s1`,
      expect.objectContaining({ method: `POST` })
    )
  })

  it(`resolves async headers before opening the durable stream`, async () => {
    durableStreamMocks.stream.mockResolvedValueOnce({
      offset: `42`,
      async *jsonStream() {},
      closed: Promise.resolve(),
    })
    const fetchMock = vi.fn()
    vi.stubGlobal(`fetch`, fetchMock)

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: {
        dispatchWake: vi.fn(),
        drainWakes: vi.fn(),
        abortWakes: vi.fn(),
      },
      headers: async () => ({
        Authorization: `Bearer tenant-token`,
        'X-Tenant': `tenant-a`,
      }),
      heartbeatIntervalMs: 0,
    })

    runner.start()
    await runner.waitForStopped()

    expect(durableStreamMocks.DurableStream).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `http://server/runners/runner-1/wake`,
        headers: {
          authorization: `Bearer tenant-token`,
          'x-tenant': `tenant-a`,
        },
      })
    )
    expect(durableStreamMocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        live: true,
        json: true,
      })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
