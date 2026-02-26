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
