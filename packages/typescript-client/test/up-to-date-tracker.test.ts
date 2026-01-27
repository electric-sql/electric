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
    // This test reproduces a bug where replay mode never exits when CDN
    // keeps returning the same cursor, causing all up-to-dates to be suppressed.
    //
    // Bug scenario (without fix):
    // 1. User had cursor=1000 in tracker from previous session
    // 2. CDN keeps returning cursor=1000 (cached responses)
    // 3. Each up-to-date is suppressed because cursor matches
    // 4. #lastSeenCursor never cleared -> infinite loop of suppressed requests
    //
    // Fixed behavior:
    // 1. First request: cursor matches, suppress up-to-date, clear #lastSeenCursor
    // 2. Second request: #replayMode is false, up-to-date published normally

    let fetchCallCount = 0
    let gotUpToDate = false
    const maxCalls = 10

    // Pre-populate the tracker: user got up-to-date recently with cursor=1000
    const shapeKey = `${shapeUrl}?table=cdn_loop_test`
    upToDateTracker.recordUpToDate(shapeKey, `1000`)

    // Mock CDN that always returns the same cursor (simulates cached responses)
    // Abort after maxCalls to prevent actual infinite loop
    fetchMock.mockImplementation(() => {
      fetchCallCount++
      if (fetchCallCount >= maxCalls) {
        aborter.abort()
        return Promise.reject(new Error(`Aborted - too many calls`))
      }

      return Promise.resolve(
        new Response(JSON.stringify([{ headers: { control: `up-to-date` } }]), {
          status: 200,
          headers: {
            'electric-handle': `test-handle`,
            'electric-offset': `0_0`,
            'electric-schema': `{}`,
            'electric-cursor': `1000`, // Always same cursor
          },
        })
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `cdn_loop_test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: true,
    })

    // Wait for up-to-date message or timeout
    const upToDatePromise = new Promise<void>((resolve) => {
      stream.subscribe((messages) => {
        const hasUpToDate = messages.some(
          (msg) => `headers` in msg && msg.headers.control === `up-to-date`
        )
        if (hasUpToDate) {
          gotUpToDate = true
          aborter.abort()
          resolve()
        }
      })
    })

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        aborter.abort()
        resolve()
      }, 500)
    })

    await Promise.race([upToDatePromise, timeoutPromise])

    // With the fix: should get up-to-date within 2-3 requests
    // Without the fix: would hit maxCalls without getting up-to-date
    expect(gotUpToDate).toBe(true)
    expect(fetchCallCount).toBeLessThanOrEqual(3)
  })
})
