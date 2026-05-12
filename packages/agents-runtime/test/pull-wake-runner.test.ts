import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPullWakeRunner } from '../src/pull-wake-runner'
import type { PullWakeEvent } from '../src/pull-wake-runner'
import type { WakeNotification } from '../src/types'

describe(`createPullWakeRunner`, () => {
  afterEach(() => {
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
})
