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

    // Advance one normal interval (10s) — should NOT trigger wake detection
    await vi.advanceTimersByTimeAsync(10_001)
    expect(fetchSignals[fetchSignals.length - 1]?.aborted).toBe(false)

    // Simulate system sleep by jumping Date.now() forward 30s
    const currentTime = Date.now()
    vi.setSystemTime(currentTime + 30_000)

    // Trigger the next interval tick and allow async restart
    await vi.advanceTimersByTimeAsync(10_001)
    await vi.advanceTimersByTimeAsync(100)

    expect(fetchSignals[0]?.aborted).toBe(true)
    expect(fetchSignals[0]?.reason).toBe(`system-wake`)
    expect(fetchCallCount).toBeGreaterThan(initialFetchCount)

    unsub()
    aborter.abort()
    vi.useRealTimers()
  })
})
