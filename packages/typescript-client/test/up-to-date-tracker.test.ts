import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeStream } from '../src'
import { UpToDateTracker, upToDateTracker } from '../src/up-to-date-tracker'

describe(`UpToDateTracker`, () => {
  let tracker: UpToDateTracker
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController
  let fetchMock: ReturnType<
    typeof vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >
  >

  beforeEach(() => {
    localStorage.clear()
    tracker = new UpToDateTracker()
    upToDateTracker.clear()
    aborter = new AbortController()
    fetchMock =
      vi.fn<
        (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      >()
    vi.clearAllMocks()
  })

  afterEach(() => aborter.abort())

  it(`should not enter replay mode when no recent up-to-date`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // No previous up-to-date recorded
    expect(tracker.shouldEnterReplayMode(shapeKey)).toBe(null)
  })

  it(`should enter replay mode when recent up-to-date exists`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Record an up-to-date
    tracker.recordUpToDate(shapeKey, `cursor-100`)

    // Should enter replay mode immediately after
    expect(tracker.shouldEnterReplayMode(shapeKey)).toBe(`cursor-100`)
  })

  it(`should not enter replay mode after TTL expires`, async () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Create tracker with very short TTL for testing
    const testTracker = new UpToDateTracker()
    // Override the TTL via reflection for testing
    ;(testTracker as any).cacheTTL = 50 // 50ms

    // Record an up-to-date
    testTracker.recordUpToDate(shapeKey, `cursor-100`)

    // Should enter replay mode immediately
    expect(testTracker.shouldEnterReplayMode(shapeKey)).toBe(`cursor-100`)

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60))

    // Should not enter replay mode after expiry
    expect(testTracker.shouldEnterReplayMode(shapeKey)).toBe(null)
  })

  it(`should persist to localStorage`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Record an up-to-date
    tracker.recordUpToDate(shapeKey, `cursor-100`)

    // Check that localStorage was updated
    const storedData = JSON.parse(
      localStorage.getItem(`electric_up_to_date_tracker`) || `{}`
    )
    expect(storedData[shapeKey]).toEqual({
      timestamp: expect.any(Number),
      cursor: `cursor-100`,
    })
    expect(Date.now() - storedData[shapeKey].timestamp).toBeLessThan(100)
  })

  it(`should load from localStorage on initialization`, () => {
    const existingShapeKey = `https://example.com/v1/shape?table=existing`
    const timestamp = Date.now() - 1000 // 1 second ago

    // Pre-populate localStorage
    const existingData = {
      [existingShapeKey]: {
        timestamp,
        cursor: `cursor-existing`,
      },
    }
    localStorage.setItem(
      `electric_up_to_date_tracker`,
      JSON.stringify(existingData)
    )

    // Create new tracker - this should load from localStorage
    const newTracker = new UpToDateTracker()

    // Should enter replay mode based on loaded data
    expect(newTracker.shouldEnterReplayMode(existingShapeKey)).toBe(
      `cursor-existing`
    )
  })

  it(`should clean up expired entries on initialization`, () => {
    const oldShapeKey = `https://example.com/v1/shape?table=old`
    const recentShapeKey = `https://example.com/v1/shape?table=recent`
    const oldTimestamp = Date.now() - 70_000 // 70 seconds ago (past TTL)
    const recentTimestamp = Date.now() - 5_000 // 5 seconds ago

    // Pre-populate localStorage with both old and recent entries
    const existingData = {
      [oldShapeKey]: {
        timestamp: oldTimestamp,
        cursor: `cursor-old`,
      },
      [recentShapeKey]: {
        timestamp: recentTimestamp,
        cursor: `cursor-recent`,
      },
    }
    localStorage.setItem(
      `electric_up_to_date_tracker`,
      JSON.stringify(existingData)
    )

    // Create new tracker - should clean up old entries
    const newTracker = new UpToDateTracker()

    // Old entry should be cleaned up
    expect(newTracker.shouldEnterReplayMode(oldShapeKey)).toBe(null)

    // Recent entry should still trigger replay mode
    expect(newTracker.shouldEnterReplayMode(recentShapeKey)).toBe(
      `cursor-recent`
    )
  })

  it(`should enforce LRU behavior with max entries`, () => {
    // Record many shapes (exceeds max of 250)
    for (let i = 1; i <= 252; i++) {
      tracker.recordUpToDate(
        `https://example.com/shape?table=table${i}`,
        `cursor-${i}`
      )
    }

    // The first two shapes should have been evicted
    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table1`)
    ).toBe(null)

    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table2`)
    ).toBe(null)

    // Recent shapes should still be tracked
    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table251`)
    ).toBe(`cursor-251`)

    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table252`)
    ).toBe(`cursor-252`)
  })

  it(`should handle localStorage errors gracefully`, () => {
    const originalLocalStorage = global.localStorage

    // Remove localStorage to simulate unavailability
    delete (global as unknown as { localStorage: unknown }).localStorage

    try {
      // Should not throw when localStorage is unavailable
      expect(() => {
        const trackerWithoutStorage = new UpToDateTracker()
        const testKey = `https://example.com/shape?table=test`

        // Can still record (in memory only)
        trackerWithoutStorage.recordUpToDate(testKey, `cursor-test`)

        // Should still enter replay mode (kept in memory)
        expect(trackerWithoutStorage.shouldEnterReplayMode(testKey)).toBe(
          `cursor-test`
        )
      }).not.toThrow()
    } finally {
      // Restore localStorage
      global.localStorage = originalLocalStorage
    }
  })

  it(`should clear all tracked timestamps`, () => {
    const shapeKey1 = `https://example.com/v1/shape?table=test1`
    const shapeKey2 = `https://example.com/v1/shape?table=test2`

    // Record multiple up-to-dates
    tracker.recordUpToDate(shapeKey1, `cursor-1`)
    tracker.recordUpToDate(shapeKey2, `cursor-2`)

    // Both should trigger replay mode
    expect(tracker.shouldEnterReplayMode(shapeKey1)).toBe(`cursor-1`)
    expect(tracker.shouldEnterReplayMode(shapeKey2)).toBe(`cursor-2`)

    // Clear tracker
    tracker.clear()

    // Neither should trigger replay mode after clear
    expect(tracker.shouldEnterReplayMode(shapeKey1)).toBe(null)
    expect(tracker.shouldEnterReplayMode(shapeKey2)).toBe(null)
  })

  it(`should suppress cached up-to-dates during replay mode`, async () => {
    const notifications: any[] = []

    // Pre-populate localStorage to simulate a previous session
    const shapeKey = `${shapeUrl}?table=test`
    const timestamp = Date.now() - 1000 // 1 second ago
    localStorage.setItem(
      `electric_up_to_date_tracker`,
      JSON.stringify({
        [shapeKey]: {
          timestamp,
          cursor: `cursor-1`,
        },
      })
    )

    // Simulate multiple cached responses
    fetchMock
      // First cached response with up-to-date
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              headers: { control: `up-to-date` },
            },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `test-handle-1`,
              'electric-offset': `0_0`,
              'electric-schema': `{}`,
              'electric-cursor': `cursor-1`,
            },
          }
        )
      )
      // Second cached response with up-to-date
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              headers: { control: `up-to-date` },
            },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `test-handle-1`,
              'electric-offset': `1_0`,
              'electric-schema': `{}`,
              'electric-cursor': `cursor-2`,
            },
          }
        )
      )
      // Live mode response with up-to-date (should NOT be suppressed)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              headers: { control: `up-to-date` },
            },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `test-handle-1`,
              'electric-offset': `2_0`,
              'electric-schema': `{}`,
              'electric-cursor': `cursor-3`,
            },
          }
        )
      )

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: `test-handle-1`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe((messages) => {
      notifications.push(messages)
    })

    // Wait for requests to complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should only get notification from the live (third) up-to-date
    // The first two cached up-to-dates should be suppressed
    expect(notifications.length).toBeLessThan(3)
  })

  it(`should track different shapes independently`, () => {
    const shapeKey1 = `https://example.com/v1/shape?table=table1`
    const shapeKey2 = `https://example.com/v1/shape?table=table2`

    // Record up-to-date for shape1 only
    tracker.recordUpToDate(shapeKey1, `cursor-shape1`)

    // Shape1 should enter replay mode
    expect(tracker.shouldEnterReplayMode(shapeKey1)).toBe(`cursor-shape1`)

    // Shape2 should not (no previous up-to-date)
    expect(tracker.shouldEnterReplayMode(shapeKey2)).toBe(null)
  })

  it(`should not infinite loop when CDN keeps returning same cursor`, async () => {
    // This test reproduces a bug where the client gets stuck in an infinite loop
    // when the CDN keeps returning cached responses with the same cursor as localStorage.
    //
    // Scenario:
    // 1. User was on page, got up-to-date with cursor=1000, stored in localStorage
    // 2. User refreshes page within 60s (localStorage entry still valid)
    // 3. Client enters replay mode with lastSeenCursor=1000
    // 4. First request (offset=-1) → CDN returns cached initial response with cursor=1000
    // 5. Client processes, sets isUpToDate=true, cursor matches → SUPPRESSES notification
    // 6. BUG: #lastSeenCursor is NOT cleared, stays in replay mode
    // 7. Next request (live=true&cursor=1000) → CDN cache hit, returns cursor=1000
    // 8. Cursor still matches → SUPPRESSES again, loop continues forever
    //
    // The fix: clear #lastSeenCursor after first suppression to exit replay mode.

    let fetchCallCount = 0
    const maxFetchCalls = 10 // Safety limit to detect infinite loop

    // Simulate CDN cache: maps URL patterns to cached responses
    const cdnCache: Record<string, { cursor: string; offset: string }> = {
      // Initial request (no live param) - cached from previous session
      initial: { cursor: `1000`, offset: `0_0` },
      // Live request with cursor=1000 - also cached
      live_1000: { cursor: `1000`, offset: `0_0` },
    }

    // Pre-populate localStorage: user got up-to-date 1 second ago with cursor=1000
    const shapeKey = `${shapeUrl}?table=cdn_loop_test`
    localStorage.setItem(
      `electric_up_to_date_tracker`,
      JSON.stringify({
        [shapeKey]: {
          timestamp: Date.now() - 1000, // 1 second ago
          cursor: `1000`,
        },
      })
    )

    // Mock CDN that caches responses based on URL
    const cdnMock = vi.fn((input: RequestInfo | URL) => {
      fetchCallCount++
      const url = new URL(input.toString())
      const isLive = url.searchParams.get(`live`) === `true`
      const cursor = url.searchParams.get(`cursor`)

      // Safety valve: abort if we're in an infinite loop
      if (fetchCallCount > maxFetchCalls) {
        aborter.abort()
        return Promise.reject(
          new Error(`Infinite loop detected after ${maxFetchCalls} requests`)
        )
      }

      // Determine which cached response to return
      let cacheKey: string
      if (isLive && cursor) {
        cacheKey = `live_${cursor}`
      } else {
        cacheKey = `initial`
      }

      const cached = cdnCache[cacheKey] || cdnCache[`initial`]

      return Promise.resolve(
        new Response(JSON.stringify([{ headers: { control: `up-to-date` } }]), {
          status: 200,
          headers: {
            'electric-handle': `test-handle`,
            'electric-offset': cached.offset,
            'electric-schema': `{}`,
            'electric-cursor': cached.cursor,
          },
        })
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `cdn_loop_test` },
      signal: aborter.signal,
      fetchClient: cdnMock,
      subscribe: true, // Keep subscribing to live updates (this is where the loop happens)
    })

    const notifications: unknown[] = []
    stream.subscribe((messages) => {
      notifications.push(messages)
    })

    // Wait for requests to settle - with the bug, it will hit maxFetchCalls quickly
    await new Promise((resolve) => setTimeout(resolve, 200))

    // With the bug: fetchCallCount hits maxFetchCalls (10+) in milliseconds because:
    //   - Each request returns cursor=1000
    //   - Cursor matches localStorage → suppressed
    //   - #lastSeenCursor is NOT cleared → stays in replay mode
    //   - Next request also returns cursor=1000 → suppressed again
    //   - Tight loop with no delay
    //
    // With the fix: should stabilize after 2 requests:
    //   1. Initial request → cursor matches → suppressed, BUT now exits replay mode
    //   2. Live request → not in replay mode → notifies subscribers, continues normally
    //   (subsequent requests would still return cursor=1000 but wouldn't loop rapidly
    //    because subscriber notifications happen normally)

    // This is the key assertion: without the fix, we'll have hit maxFetchCalls (10+)
    // With the fix, we should have at most a few requests
    expect(fetchCallCount).toBeLessThanOrEqual(3)

    // Should have received at least one notification once we exit replay mode
    expect(notifications.length).toBeGreaterThanOrEqual(1)
  })
})
