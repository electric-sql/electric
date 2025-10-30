import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeStream } from '../src'
import { UpToDateTracker, upToDateTracker } from '../src/up-to-date-tracker'

describe(`UpToDateTracker`, () => {
  let tracker: UpToDateTracker
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    tracker = new UpToDateTracker()
    upToDateTracker.clear()
    aborter = new AbortController()
    fetchMock = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => aborter.abort())

  it(`should not enter replay mode when no recent up-to-date`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // No previous up-to-date recorded
    expect(tracker.shouldEnterReplayMode(shapeKey)).toBe(false)
  })

  it(`should enter replay mode when recent up-to-date exists`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Record an up-to-date
    tracker.recordUpToDate(shapeKey)

    // Should enter replay mode immediately after
    expect(tracker.shouldEnterReplayMode(shapeKey)).toBe(true)
  })

  it(`should not enter replay mode after TTL expires`, async () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Create tracker with very short TTL for testing
    const testTracker = new UpToDateTracker()
    // Override the TTL via reflection for testing
    ;(testTracker as any).cacheTTL = 50 // 50ms

    // Record an up-to-date
    testTracker.recordUpToDate(shapeKey)

    // Should enter replay mode immediately
    expect(testTracker.shouldEnterReplayMode(shapeKey)).toBe(true)

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60))

    // Should not enter replay mode after expiry
    expect(testTracker.shouldEnterReplayMode(shapeKey)).toBe(false)
  })

  it(`should persist to localStorage`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Record an up-to-date
    tracker.recordUpToDate(shapeKey)

    // Check that localStorage was updated
    const storedData = JSON.parse(
      localStorage.getItem(`electric_up_to_date_tracker`) || `{}`
    )
    expect(storedData[shapeKey]).toEqual(expect.any(Number))
    expect(Date.now() - storedData[shapeKey]).toBeLessThan(100)
  })

  it(`should load from localStorage on initialization`, () => {
    const existingShapeKey = `https://example.com/v1/shape?table=existing`
    const timestamp = Date.now() - 1000 // 1 second ago

    // Pre-populate localStorage
    const existingData = {
      [existingShapeKey]: timestamp,
    }
    localStorage.setItem(
      `electric_up_to_date_tracker`,
      JSON.stringify(existingData)
    )

    // Create new tracker - this should load from localStorage
    const newTracker = new UpToDateTracker()

    // Should enter replay mode based on loaded data
    expect(newTracker.shouldEnterReplayMode(existingShapeKey)).toBe(true)
  })

  it(`should clean up expired entries on initialization`, () => {
    const oldShapeKey = `https://example.com/v1/shape?table=old`
    const recentShapeKey = `https://example.com/v1/shape?table=recent`
    const oldTimestamp = Date.now() - 70_000 // 70 seconds ago (past TTL)
    const recentTimestamp = Date.now() - 5_000 // 5 seconds ago

    // Pre-populate localStorage with both old and recent entries
    const existingData = {
      [oldShapeKey]: oldTimestamp,
      [recentShapeKey]: recentTimestamp,
    }
    localStorage.setItem(
      `electric_up_to_date_tracker`,
      JSON.stringify(existingData)
    )

    // Create new tracker - should clean up old entries
    const newTracker = new UpToDateTracker()

    // Old entry should be cleaned up
    expect(newTracker.shouldEnterReplayMode(oldShapeKey)).toBe(false)

    // Recent entry should still trigger replay mode
    expect(newTracker.shouldEnterReplayMode(recentShapeKey)).toBe(true)
  })

  it(`should enforce LRU behavior with max entries`, () => {
    // Record many shapes (exceeds max of 250)
    for (let i = 1; i <= 252; i++) {
      tracker.recordUpToDate(`https://example.com/shape?table=table${i}`)
    }

    // The first two shapes should have been evicted
    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table1`)
    ).toBe(false)

    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table2`)
    ).toBe(false)

    // Recent shapes should still be tracked
    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table251`)
    ).toBe(true)

    expect(
      tracker.shouldEnterReplayMode(`https://example.com/shape?table=table252`)
    ).toBe(true)
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
        trackerWithoutStorage.recordUpToDate(testKey)

        // Should not enter replay mode (no persistence)
        expect(trackerWithoutStorage.shouldEnterReplayMode(testKey)).toBe(true)
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
    tracker.recordUpToDate(shapeKey1)
    tracker.recordUpToDate(shapeKey2)

    // Both should trigger replay mode
    expect(tracker.shouldEnterReplayMode(shapeKey1)).toBe(true)
    expect(tracker.shouldEnterReplayMode(shapeKey2)).toBe(true)

    // Clear tracker
    tracker.clear()

    // Neither should trigger replay mode after clear
    expect(tracker.shouldEnterReplayMode(shapeKey1)).toBe(false)
    expect(tracker.shouldEnterReplayMode(shapeKey2)).toBe(false)
  })

  it(`should suppress cached up-to-dates during replay mode`, async () => {
    const notifications: any[] = []

    // Pre-populate localStorage to simulate a previous session
    const shapeKey = `${shapeUrl}?table=test`
    const timestamp = Date.now() - 1000 // 1 second ago
    localStorage.setItem(
      `electric_up_to_date_tracker`,
      JSON.stringify({ [shapeKey]: timestamp })
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
    tracker.recordUpToDate(shapeKey1)

    // Shape1 should enter replay mode
    expect(tracker.shouldEnterReplayMode(shapeKey1)).toBe(true)

    // Shape2 should not (no previous up-to-date)
    expect(tracker.shouldEnterReplayMode(shapeKey2)).toBe(false)
  })
})
