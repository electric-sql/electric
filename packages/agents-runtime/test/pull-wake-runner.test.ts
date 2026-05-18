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

function wakeEvent(id: string): PullWakeEvent {
  return {
    type: `wake`,
    subscription_id: `runner:runner-1`,
    stream: `chat/${id}/main`,
    generation: 7,
    ts: 123,
  }
}

function notification(id: string): WakeNotification {
  return {
    consumerId: `wake-${id}`,
    epoch: 7,
    wakeId: `wake-${id}`,
    streamPath: `/chat/${id}/main`,
    streams: [{ path: `/chat/${id}/main`, offset: `12` }],
    callback: `http://server/_electric/callback-forward/wake-${id}`,
    claimToken: `claim-token-${id}`,
    entity: {
      type: `chat`,
      status: `idle`,
      url: `/chat/${id}`,
      streams: { main: `/chat/${id}/main`, error: `/chat/${id}/error` },
    },
  }
}

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitFor(
  assertion: () => void,
  timeoutMs = 1_000
): Promise<void> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw lastError
}

function runtime() {
  return {
    dispatchWake: vi.fn(),
    drainWakes: vi.fn(async () => undefined),
    abortWakes: vi.fn(),
  }
}

describe(`createPullWakeRunner`, () => {
  afterEach(() => {
    durableStreamMocks.DurableStream.mockClear()
    durableStreamMocks.stream.mockReset()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it(`claims compact DS wake events before dispatching runtime wakes`, async () => {
    const event = wakeEvent(`one`)
    const claimed = notification(`one`)
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json(claimed)
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const testRuntime = runtime()
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
      runtime: testRuntime,
      headers: { 'x-test-runner': `runner-1` },
      claimHeaders: { authorization: `Bearer session-token` },
      claimTokenHeader: `electric-claim-token`,
      heartbeatIntervalMs: 0,
      streamFactory,
    })

    runner.start()
    await waitFor(() => {
      expect(testRuntime.dispatchWake).toHaveBeenCalledTimes(1)
    })

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
    expect(testRuntime.dispatchWake).toHaveBeenCalledWith(claimed, {
      claimHeaders: expect.any(Function),
      claimTokenHeader: `electric-claim-token`,
    })
    expect(testRuntime.drainWakes).not.toHaveBeenCalled()
    expect(runner.offset).toBe(`42`)

    await runner.stop()
    expect(testRuntime.drainWakes).toHaveBeenCalledTimes(1)
  })

  it(`skips stale wake events when claim returns no pending work`, async () => {
    const event = wakeEvent(`one`)
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
    const testRuntime = runtime()
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
      runtime: testRuntime,
      headers: { 'x-test-runner': `runner-1` },
      heartbeatIntervalMs: 0,
      streamFactory,
      onError,
    })

    runner.start()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(testRuntime.dispatchWake).not.toHaveBeenCalled()
    expect(testRuntime.drainWakes).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(runner.offset).toBe(`42`)

    await runner.stop()
  })

  it(`exposes diagnostics via getHealth()`, async () => {
    const event = wakeEvent(`one`)
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json(notification(`one`))
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const testRuntime = runtime()
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
      runtime: testRuntime,
      heartbeatIntervalMs: 0,
      streamFactory,
    })

    const healthBefore = runner.getHealth()
    expect(healthBefore.running).toBe(false)
    expect(healthBefore.started_at).toBeNull()
    expect(healthBefore.events_received).toBe(0)

    runner.start()
    await waitFor(() => {
      expect(testRuntime.dispatchWake).toHaveBeenCalledTimes(1)
    })

    const healthDuring = runner.getHealth()
    expect(healthDuring.running).toBe(true)
    expect(healthDuring.started_at).not.toBeNull()
    expect(healthDuring.events_received).toBe(1)
    expect(healthDuring.claims_succeeded).toBe(1)
    expect(healthDuring.last_claim_result).toBe(`claimed`)
    expect(healthDuring.last_dispatch_at).not.toBeNull()
    expect(healthDuring.offset).toBe(`42`)

    await runner.stop()
    expect(runner.getHealth().running).toBe(false)
  })

  it(`preserves base URL query parameters on stream, claim, and heartbeat requests`, async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(`/heartbeat`)) return Response.json({})
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal(`fetch`, fetchMock)
    const streamFactory = vi.fn(async () => ({
      offset: `42`,
      async *jsonStream() {
        yield wakeEvent(`one`)
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server/root?secret=s1`,
      runnerId: `runner-1`,
      runtime: runtime(),
      heartbeatIntervalMs: 5,
      streamFactory,
    })

    runner.start()
    await waitFor(() => {
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

    await runner.stop()
  })

  it(`sends a throttled heartbeat when runner diagnostics change`, async () => {
    const heartbeatBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes(`/heartbeat`)) {
          heartbeatBodies.push(JSON.parse(String(init?.body)))
          return Response.json({})
        }
        return Response.json(notification(`one`))
      }
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const testRuntime = runtime()
    const streamFactory = vi.fn(async () => ({
      offset: `42`,
      async *jsonStream() {
        yield wakeEvent(`one`)
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: testRuntime,
      heartbeatIntervalMs: 60_000,
      eventHeartbeatThrottleMs: 20,
      streamFactory,
    })

    runner.start()
    await waitFor(() => {
      expect(testRuntime.dispatchWake).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(heartbeatBodies.length).toBe(2)
    })

    const diagnostics = heartbeatBodies[1]!.diagnostics as Record<
      string,
      unknown
    >
    expect(diagnostics.events_received).toBe(1)
    expect(diagnostics.claims_succeeded).toBe(1)
    expect(heartbeatBodies[1]!.wake_stream_offset).toBe(`42`)

    await runner.stop()
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
      runtime: runtime(),
      headers: async () => ({
        Authorization: `Bearer tenant-token`,
        'X-Tenant': `tenant-a`,
      }),
      heartbeatIntervalMs: 0,
    })

    runner.start()
    await waitFor(() => {
      expect(durableStreamMocks.DurableStream).toHaveBeenCalledTimes(1)
    })
    await runner.stop()

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

  it(`continues reading and claiming while runtime wakes are pending`, async () => {
    const events = [wakeEvent(`one`), wakeEvent(`two`)]
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        Response.json(
          notification(JSON.parse(String(init?.body)).stream.split(`/`)[1])
        )
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const testRuntime = runtime()
    const streamFactory = vi.fn(async () => ({
      offset: `84`,
      async *jsonStream() {
        yield events[0]!
        yield events[1]!
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: testRuntime,
      heartbeatIntervalMs: 0,
      streamFactory,
    })

    runner.start()
    await waitFor(() => {
      expect(testRuntime.dispatchWake).toHaveBeenCalledTimes(2)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(testRuntime.drainWakes).not.toHaveBeenCalled()
    await runner.stop()
  })

  it(`pauses claim spawning at maxConcurrentClaims without unbounded queuing`, async () => {
    const firstClaim = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => firstClaim.promise)
      .mockImplementationOnce(async () => Response.json(notification(`two`)))
    vi.stubGlobal(`fetch`, fetchMock)
    const testRuntime = runtime()
    const streamFactory = vi.fn(async () => ({
      offset: `84`,
      async *jsonStream() {
        yield wakeEvent(`one`)
        yield wakeEvent(`two`)
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: testRuntime,
      heartbeatIntervalMs: 0,
      maxConcurrentClaims: 1,
      streamFactory,
    })

    runner.start()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    firstClaim.resolve(Response.json(notification(`one`)))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(testRuntime.dispatchWake).toHaveBeenCalledTimes(2)
    })

    await runner.stop()
  })

  it(`skips dispatch from a claim actor after shutdown begins`, async () => {
    const claimResponse = deferred<Response>()
    const fetchMock = vi.fn(async () => claimResponse.promise)
    vi.stubGlobal(`fetch`, fetchMock)
    const calls: Array<string> = []
    const testRuntime = {
      dispatchWake: vi.fn(() => calls.push(`dispatch`)),
      abortWakes: vi.fn(() => calls.push(`abort`)),
      drainWakes: vi.fn(async () => {
        calls.push(`drain`)
      }),
    }
    const streamFactory = vi.fn(async () => ({
      offset: `42`,
      async *jsonStream() {
        yield wakeEvent(`one`)
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: testRuntime,
      heartbeatIntervalMs: 0,
      streamFactory,
    })

    runner.start()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const stopped = runner.stop()
    claimResponse.resolve(Response.json(notification(`one`)))
    await stopped

    expect(testRuntime.dispatchWake).not.toHaveBeenCalled()
    expect(calls).toEqual([`abort`, `drain`])
    expect(runner.getHealth().claims_succeeded).toBe(1)
    expect(runner.getHealth().claims_skipped).toBe(0)
  })

  it(`keeps heartbeating degraded diagnostics while reconnecting`, async () => {
    const heartbeatBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes(`/heartbeat`)) {
          heartbeatBodies.push(JSON.parse(String(init?.body)))
          return Response.json({})
        }
        return new Response(null, { status: 204 })
      }
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const onError = vi.fn()
    const streamFactory = vi.fn(async () => {
      throw new Error(`stream failed`)
    })

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: runtime(),
      heartbeatIntervalMs: 5,
      streamFactory,
      onError,
    })

    runner.start()
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(
        heartbeatBodies.some((body) => {
          const diagnostics = body.diagnostics as
            | Record<string, unknown>
            | undefined
          return (
            diagnostics?.stream_connected === false &&
            diagnostics?.reconnect_count === 1
          )
        })
      ).toBe(true)
    })

    await runner.stop()
  })

  it(`forces the stream to reconnect after repeated heartbeat failures`, async () => {
    vi.useFakeTimers()
    const firstStreamOpened = deferred<void>()
    const secondStreamOpened = deferred<void>()
    const firstStreamClosed = deferred<void>()
    const secondStreamClosed = deferred<void>()
    const firstCancel = vi.fn(() => firstStreamClosed.resolve())
    const streamFactory = vi.fn(async () => {
      if (streamFactory.mock.calls.length === 1) {
        firstStreamOpened.resolve()
        return {
          async *jsonStream() {
            await firstStreamClosed.promise
          },
          cancel: firstCancel,
          closed: firstStreamClosed.promise,
        }
      }
      secondStreamOpened.resolve()
      return {
        async *jsonStream() {
          await secondStreamClosed.promise
        },
        cancel: () => secondStreamClosed.resolve(),
        closed: secondStreamClosed.promise,
      }
    })
    let heartbeatCalls = 0
    const fetchMock = vi.fn(async () => {
      heartbeatCalls++
      if (heartbeatCalls <= 2) {
        throw new Error(`connect ECONNREFUSED 127.0.0.1:4437`)
      }
      return Response.json({})
    })
    vi.stubGlobal(`fetch`, fetchMock)

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: runtime(),
      heartbeatIntervalMs: 10,
      eventHeartbeatThrottleMs: 0,
      streamFactory,
    })

    runner.start()
    await firstStreamOpened.promise
    await vi.advanceTimersByTimeAsync(20)

    expect(firstCancel).toHaveBeenCalledWith(expect.any(Error))

    await vi.advanceTimersByTimeAsync(1_000)
    await secondStreamOpened.promise

    expect(streamFactory).toHaveBeenCalledTimes(2)
    expect(runner.getHealth().reconnect_count).toBe(1)

    await runner.stop()
  })

  it(`marks heartbeat unhealthy before reporting heartbeat errors`, async () => {
    const observedHeartbeatOk: Array<boolean> = []
    let runner: ReturnType<typeof createPullWakeRunner>
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes(`/heartbeat`)) {
        return new Response(null, { status: 204 })
      }
      return fetchMock.mock.calls.length === 1
        ? Response.json({})
        : new Response(`heartbeat failed`, { status: 500 })
    })
    vi.stubGlobal(`fetch`, fetchMock)
    const streamFactory = vi.fn(async () => ({
      async *jsonStream() {},
      closed: Promise.resolve(),
    }))

    runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: runtime(),
      heartbeatIntervalMs: 5,
      streamFactory,
      onError: () => {
        observedHeartbeatOk.push(runner.getHealth().last_heartbeat_ok)
      },
    })

    runner.start()
    await waitFor(() => {
      expect(observedHeartbeatOk).toContain(false)
    })

    await runner.stop()
  })

  it(`keeps onError reporting-only when the reporter throws`, async () => {
    durableStreamMocks.stream.mockImplementationOnce(
      async (opts: { onError: (error: Error) => unknown }) => {
        opts.onError(new Error(`durable stream failed`))
        return {
          async *jsonStream() {},
          closed: Promise.resolve(),
        }
      }
    )
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes(`/heartbeat`)) {
        return new Response(`heartbeat failed`, { status: 500 })
      }
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal(`fetch`, fetchMock)
    const onError = vi.fn(() => {
      throw new Error(`reporter failed`)
    })
    const consoleError = vi
      .spyOn(console, `error`)
      .mockImplementation(() => undefined)

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: runtime(),
      heartbeatIntervalMs: 5,
      onError,
    })

    runner.start()
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(runner.running).toBe(true)
    })

    expect(runner.getHealth().last_error).toMatch(/failed/)
    expect(consoleError).toHaveBeenCalledWith(
      `Pull-wake runner onError callback failed`,
      expect.any(Error)
    )
    await expect(runner.stop()).resolves.toBeUndefined()
    consoleError.mockRestore()
  })

  it(`does not let a stuck claim actor block stop or later claim capacity`, async () => {
    vi.useFakeTimers()
    const claimStarted = deferred<void>()
    const secondClaimStarted = deferred<void>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        claimStarted.resolve()
        return new Promise<Response>(() => {})
      })
      .mockImplementationOnce(async () => {
        secondClaimStarted.resolve()
        return new Promise<Response>(() => {})
      })
    vi.stubGlobal(`fetch`, fetchMock)
    const calls: Array<string> = []
    const testRuntime = {
      dispatchWake: vi.fn(() => calls.push(`dispatch`)),
      abortWakes: vi.fn(() => calls.push(`abort`)),
      drainWakes: vi.fn(async () => {
        calls.push(`drain`)
      }),
    }
    const streamFactory = vi.fn(async () => ({
      offset: `42`,
      async *jsonStream() {
        yield wakeEvent(`one`)
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: testRuntime,
      heartbeatIntervalMs: 0,
      maxConcurrentClaims: 1,
      streamFactory,
    })

    runner.start()
    await claimStarted.promise
    const stopped = runner.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    await stopped

    expect(testRuntime.dispatchWake).not.toHaveBeenCalled()
    expect(calls).toEqual([`abort`, `drain`])

    runner.start()
    await secondClaimStarted.promise
    const secondStop = runner.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    await secondStop
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it(`records a skipped claim when stop aborts a capacity wait`, async () => {
    vi.useFakeTimers()
    const claimStarted = deferred<void>()
    const secondEventYielded = deferred<void>()
    const fetchMock = vi.fn(async () => {
      claimStarted.resolve()
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal(`fetch`, fetchMock)
    const streamFactory = vi.fn(async () => ({
      offset: `84`,
      async *jsonStream() {
        yield wakeEvent(`one`)
        secondEventYielded.resolve()
        yield wakeEvent(`two`)
      },
      closed: Promise.resolve(),
    }))
    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: runtime(),
      heartbeatIntervalMs: 0,
      maxConcurrentClaims: 1,
      streamFactory,
    })

    runner.start()
    await claimStarted.promise
    await secondEventYielded.promise
    const stopped = runner.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    await stopped

    expect(runner.getHealth().events_received).toBe(2)
    expect(runner.getHealth().claims_skipped).toBe(1)
  })

  it(`throws drain errors after recording them and marking the runner stopped`, async () => {
    const drainError = new Error(`drain failed`)
    const onError = vi.fn()
    const testRuntime = {
      dispatchWake: vi.fn(),
      abortWakes: vi.fn(),
      drainWakes: vi.fn(async () => {
        throw drainError
      }),
    }
    const streamFactory = vi.fn(async () => ({
      async *jsonStream() {},
      closed: Promise.resolve(),
    }))
    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: testRuntime,
      heartbeatIntervalMs: 0,
      streamFactory,
      onError,
    })

    runner.start()
    await waitFor(() => {
      expect(streamFactory).toHaveBeenCalledTimes(1)
    })
    await expect(runner.stop()).rejects.toThrow(`drain failed`)

    expect(runner.running).toBe(false)
    expect(onError).toHaveBeenCalledWith(drainError)
    expect(runner.getHealth().last_error).toBe(`drain failed`)
  })

  it(`uses exponential reconnect backoff between failed connection attempts`, async () => {
    vi.useFakeTimers()
    const attempts = [deferred<void>(), deferred<void>(), deferred<void>()]
    const streamFactory = vi.fn(async () => {
      attempts[streamFactory.mock.calls.length - 1]?.resolve()
      throw new Error(`stream failed`)
    })
    const runner = createPullWakeRunner({
      baseUrl: `http://server`,
      runnerId: `runner-1`,
      runtime: runtime(),
      heartbeatIntervalMs: 0,
      streamFactory,
    })

    runner.start()
    await attempts[0]!.promise
    await vi.advanceTimersByTimeAsync(999)
    expect(streamFactory).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await attempts[1]!.promise
    expect(streamFactory).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1_999)
    expect(streamFactory).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await attempts[2]!.promise
    expect(streamFactory).toHaveBeenCalledTimes(3)

    await runner.stop()
  })
})
