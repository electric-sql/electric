// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShapeStream } from '../src'
import { resolveInMacrotask } from './support/test-helpers'

describe(`Wake detection`, () => {
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController

  beforeEach(() => {
    aborter = new AbortController()
  })

  afterEach(() => {
    aborter.abort()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it(`should set up wake detection timer in non-browser environments`, async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, `clearInterval`)

    const fetchWrapper = (): Promise<Response> => {
      return resolveInMacrotask(Response.error())
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    stream.unsubscribeAll()
    expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(1)

    unsub()
  })

  it(`should NOT set up wake detection timer in browser environments`, async () => {
    ;(globalThis as Record<string, unknown>).document = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    const clearIntervalSpy = vi.spyOn(globalThis, `clearInterval`)

    const fetchWrapper = (): Promise<Response> => {
      return resolveInMacrotask(Response.error())
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    stream.unsubscribeAll()
    expect(clearIntervalSpy.mock.calls.length).toBe(0)

    unsub()
    delete (globalThis as Record<string, unknown>).document
  })

  it(`should detect time gap and abort stale fetch after system wake`, async () => {
    vi.useFakeTimers()

    const fetchSignals: AbortSignal[] = []
    let fetchCallCount = 0

    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const signal = args[1]?.signal
      if (signal) fetchSignals.push(signal)
      fetchCallCount++
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(`abort`, () => reject(new Error(`aborted`)), {
          once: true,
        })
      })
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    // Wait for first fetch
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCallCount).toBeGreaterThanOrEqual(1)
    const initialFetchCount = fetchCallCount

    // Advance one normal interval (2s) — should NOT trigger wake detection
    await vi.advanceTimersByTimeAsync(2_001)
    expect(fetchSignals[fetchSignals.length - 1]?.aborted).toBe(false)

    // Simulate system sleep by jumping Date.now() forward 10s
    const currentTime = Date.now()
    vi.setSystemTime(currentTime + 10_000)

    // Trigger the next interval tick and allow async restart
    await vi.advanceTimersByTimeAsync(2_001)
    await vi.advanceTimersByTimeAsync(100)

    expect(fetchSignals[0]?.aborted).toBe(true)
    expect(fetchSignals[0]?.reason).toBe(`system-wake`)
    expect(fetchCallCount).toBeGreaterThan(initialFetchCount)

    unsub()
    aborter.abort()
  })

  it(`should restart after system wake even when AbortSignal.reason is not preserved`, async () => {
    vi.useFakeTimers()

    const originalAbort = AbortController.prototype.abort
    vi.spyOn(AbortController.prototype, `abort`).mockImplementation(function (
      this: AbortController
    ) {
      // Simulate React Native AbortController implementations that drop the
      // abort reason instead of preserving abort(`system-wake`).
      return originalAbort.call(this)
    })

    const fetchSignals: AbortSignal[] = []
    let fetchCallCount = 0

    const fetchWrapper = (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const signal = args[1]?.signal
      if (signal) fetchSignals.push(signal)
      fetchCallCount++
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(`abort`, () => reject(new Error(`aborted`)), {
          once: true,
        })
      })
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(0)
    const initialFetchCount = fetchCallCount

    const currentTime = Date.now()
    vi.setSystemTime(currentTime + 10_000)

    await vi.advanceTimersByTimeAsync(2_001)
    await vi.advanceTimersByTimeAsync(100)

    expect(fetchSignals[0]?.aborted).toBe(true)
    expect(fetchSignals[0]?.reason).not.toBe(`system-wake`)
    expect(fetchCallCount).toBeGreaterThan(initialFetchCount)

    unsub()
    aborter.abort()
  })

  it(`should reject invalid live request timeout values`, () => {
    for (const liveRequestTimeoutMs of [0, -1, Number.NaN, Infinity]) {
      expect(
        () =>
          new ShapeStream({
            url: shapeUrl,
            params: { table: `foo` },
            liveRequestTimeoutMs,
          })
      ).toThrow(
        `Invalid shape options: liveRequestTimeoutMs must be a positive finite number or false`
      )
    }

    expect(
      () =>
        new ShapeStream({
          url: shapeUrl,
          params: { table: `foo` },
          liveRequestTimeoutMs: false,
        })
    ).not.toThrow()
  })

  it(`should restart after a live request timeout even when fetch ignores abort`, async () => {
    vi.useFakeTimers()

    let fetchCallCount = 0
    const fetchSignals: AbortSignal[] = []

    const fetchWrapper = (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      fetchCallCount++
      const signal = init?.signal
      if (signal) fetchSignals.push(signal)

      const isLive = input.toString().includes(`live=true`)
      if (!isLive) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ headers: { control: `up-to-date` } }]),
            {
              status: 200,
              headers: new Headers({
                'electric-handle': `h1`,
                'electric-offset': `0_0`,
                'electric-schema': `{}`,
                'electric-up-to-date': ``,
              }),
            }
          )
        )
      }

      // Simulate React Native fetch getting wedged across app lifecycle:
      // it never resolves/rejects, and aborting the signal does not settle it.
      return new Promise<Response>(() => {})
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      liveRequestTimeoutMs: 100,
    })
    const unsub = stream.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCallCount).toBe(2)

    await vi.advanceTimersByTimeAsync(101)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchSignals[1]?.aborted).toBe(true)
    expect(fetchSignals[1]?.reason).toBe(`live-request-timeout`)
    expect(fetchCallCount).toBeGreaterThan(2)

    unsub()
    aborter.abort()
  })

  it(`should restart a hung wake catch-up request`, async () => {
    vi.useFakeTimers()

    const fetchUrls: string[] = []
    const fetchSignals: AbortSignal[] = []

    const fetchWrapper = (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = input.toString()
      fetchUrls.push(url)
      const signal = init?.signal
      if (signal) fetchSignals.push(signal)

      if (fetchUrls.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ headers: { control: `up-to-date` } }]),
            {
              status: 200,
              headers: new Headers({
                'electric-handle': `h1`,
                'electric-offset': `0_0`,
                'electric-schema': `{}`,
                'electric-up-to-date': ``,
              }),
            }
          )
        )
      }

      if (url.includes(`live=true`)) {
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            `abort`,
            () => reject(new Error(`aborted`)),
            {
              once: true,
            }
          )
        })
      }

      // Simulate a foreground catch-up request that reaches native networking but
      // never resolves or rejects. This was observed in the customer PR build:
      // wake recovery sent non-live requests, then polling stopped at those URLs.
      return new Promise<Response>(() => {})
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      liveRequestTimeoutMs: 5_000,
    })
    const unsub = stream.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchUrls).toHaveLength(2)
    expect(fetchUrls[1]).toContain(`live=true`)

    const currentTime = Date.now()
    vi.setSystemTime(currentTime + 10_000)

    await vi.advanceTimersByTimeAsync(2_001)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchSignals[1]?.aborted).toBe(true)
    expect(fetchSignals[1]?.reason).toBe(`system-wake`)
    expect(fetchUrls).toHaveLength(3)
    expect(fetchUrls[2]).not.toContain(`live=true`)

    await vi.advanceTimersByTimeAsync(5_001)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchSignals[2]?.aborted).toBe(true)
    expect(fetchSignals[2]?.reason).toBe(`live-request-timeout`)
    expect(fetchUrls.length).toBeGreaterThan(3)
    expect(fetchUrls[3]).not.toContain(`live=true`)

    unsub()
    aborter.abort()
  })

  it(`should issue a non-live refresh after system wake even when URL construction yields`, async () => {
    vi.useFakeTimers()

    const fetchUrls: string[] = []
    const fetchSignals: AbortSignal[] = []

    const fetchWrapper = (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = input.toString()
      fetchUrls.push(url)
      const signal = init?.signal
      if (signal) fetchSignals.push(signal)

      if (!url.includes(`live=true`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ headers: { control: `up-to-date` } }]),
            {
              status: 200,
              headers: new Headers({
                'electric-handle': `h1`,
                'electric-offset': `0_0`,
                'electric-schema': `{}`,
                'electric-up-to-date': ``,
              }),
            }
          )
        )
      }

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(`abort`, () => reject(new Error(`aborted`)), {
          once: true,
        })
      })
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      headers: {
        authorization: async () => {
          await Promise.resolve()
          return `Bearer token`
        },
      },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchUrls).toHaveLength(2)
    expect(fetchUrls[1]).toContain(`live=true`)

    const currentTime = Date.now()
    vi.setSystemTime(currentTime + 10_000)

    await vi.advanceTimersByTimeAsync(2_001)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchSignals[1]?.aborted).toBe(true)
    expect(fetchUrls.length).toBeGreaterThanOrEqual(3)
    expect(fetchUrls[2]).not.toContain(`live=true`)

    unsub()
    aborter.abort()
  })

  it(`should re-arm wake detection after snapshot pause and resume`, async () => {
    vi.useFakeTimers()

    const setIntervalSpy = vi.spyOn(globalThis, `setInterval`)
    const clearIntervalSpy = vi.spyOn(globalThis, `clearInterval`)

    const streamRequestSignals: AbortSignal[] = []

    const fetchWrapper = (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = input.toString()

      // Snapshot request used by requestSnapshot()
      if (url.includes(`subset__limit=`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {
                snapshot_mark: 1,
                xmin: `0`,
                xmax: `0`,
                xip_list: [],
                database_lsn: `0`,
              },
              data: [],
            }),
            {
              status: 200,
              headers: new Headers({
                'electric-offset': `0_0`,
                'electric-handle': `h1`,
                'electric-schema': JSON.stringify({}),
              }),
            }
          )
        )
      }

      const signal = init?.signal
      if (signal) streamRequestSignals.push(signal)

      // Keep stream requests pending until they get aborted by pause/resume flow.
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(`abort`, () => reject(new Error(`aborted`)), {
          once: true,
        })
      })
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      log: `changes_only`,
      signal: aborter.signal,
      fetchClient: fetchWrapper,
    })
    const unsub = stream.subscribe(() => {})

    // Let the initial stream request start.
    await vi.advanceTimersByTimeAsync(0)
    const setIntervalCountBefore = setIntervalSpy.mock.calls.length
    const clearIntervalCountBefore = clearIntervalSpy.mock.calls.length
    expect(streamRequestSignals.length).toBeGreaterThanOrEqual(1)

    // Triggers snapshot pause/resume flow.
    await stream.requestSnapshot({ limit: 1 })

    // Initial stream request should have been aborted by the pause lock.
    expect(streamRequestSignals[0]?.aborted).toBe(true)
    expect(clearIntervalSpy.mock.calls.length).toBe(
      clearIntervalCountBefore + 1
    )

    // Wake detection should be armed again after resume.
    expect(setIntervalSpy.mock.calls.length).toBe(setIntervalCountBefore + 1)

    // After resume, a new stream request should be in-flight.
    await vi.advanceTimersByTimeAsync(0)
    const postResumeSignalIndex = streamRequestSignals.length - 1
    expect(streamRequestSignals[postResumeSignalIndex]?.aborted).toBe(false)

    // Simulate system sleep by jumping Date.now() forward past the wake threshold.
    const currentTime = Date.now()
    vi.setSystemTime(currentTime + 10_000)

    // Trigger the interval tick so wake detection fires.
    await vi.advanceTimersByTimeAsync(2_001)
    await vi.advanceTimersByTimeAsync(100)

    // The re-armed timer should have detected the time gap and aborted the request.
    expect(streamRequestSignals[postResumeSignalIndex]?.aborted).toBe(true)
    expect(streamRequestSignals[postResumeSignalIndex]?.reason).toBe(
      `system-wake`
    )

    unsub()
    aborter.abort()
  })

  it(`should not create duplicate wake detection timers on error retry`, async () => {
    vi.useFakeTimers()

    const setIntervalSpy = vi.spyOn(globalThis, `setInterval`)

    let fetchCallCount = 0
    const fetchWrapper = (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        // Return a 400 error — client errors are not retried by the backoff
        // layer, so the FetchError propagates directly to #start()'s catch block.
        return Promise.resolve(new Response(`Bad Request`, { status: 400 }))
      }
      // Keep subsequent requests pending.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          `abort`,
          () => reject(new Error(`aborted`)),
          {
            once: true,
          }
        )
      })
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `foo` },
      signal: aborter.signal,
      fetchClient: fetchWrapper,
      backoffOptions: {
        initialDelay: 0,
        maxDelay: 0,
        multiplier: 1,
        maxRetries: Infinity,
      },
      onError: () => ({ params: {} }),
    })
    const unsub = stream.subscribe(() => {})

    // Let the stream start, hit the 400 error, and retry via onError.
    // The error retry path (#start lines 767-769) calls #start() recursively
    // WITHOUT calling #teardown() first, so the timer is still alive.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchCallCount).toBeGreaterThanOrEqual(2)

    // The idempotency guard should prevent a duplicate timer —
    // only one setInterval despite two #start() calls.
    expect(setIntervalSpy.mock.calls.length).toBe(1)

    unsub()
    aborter.abort()
  })
})
