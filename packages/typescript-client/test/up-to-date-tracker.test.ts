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

  it(`should allow first up-to-date notification`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // First notification should be allowed
    expect(tracker.shouldNotifySubscribers(shapeKey, false)).toBe(true)
  })

  it(`should suppress up-to-date notifications within TTL window`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // First notification should be allowed
    expect(tracker.shouldNotifySubscribers(shapeKey, false)).toBe(true)

    // Subsequent notification within TTL should be suppressed
    expect(tracker.shouldNotifySubscribers(shapeKey, false)).toBe(false)
  })

  it(`should always allow live SSE messages`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Record a non-live up-to-date
    tracker.shouldNotifySubscribers(shapeKey, false)

    // Live message should still be allowed
    expect(tracker.shouldNotifySubscribers(shapeKey, true)).toBe(true)
  })

  it(`should allow notifications after TTL expires`, async () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Create tracker with very short TTL for testing
    const testTracker = new UpToDateTracker()
    // Override the TTL via reflection for testing
    ;(testTracker as any).cacheTTL = 50 // 50ms

    // First notification
    expect(testTracker.shouldNotifySubscribers(shapeKey, false)).toBe(true)

    // Immediate second should be suppressed
    expect(testTracker.shouldNotifySubscribers(shapeKey, false)).toBe(false)

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60))

    // After TTL, should allow again
    expect(testTracker.shouldNotifySubscribers(shapeKey, false)).toBe(true)
  })

  it(`should suppress rapid successive up-to-dates within suppression window`, async () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    const testTracker = new UpToDateTracker()
    // Override suppression window for testing
    ;(testTracker as any).suppressionWindowMs = 100 // 100ms

    // First notification
    expect(testTracker.shouldNotifySubscribers(shapeKey, false)).toBe(true)

    // Immediate second should be suppressed
    expect(testTracker.shouldNotifySubscribers(shapeKey, false)).toBe(false)

    // Wait less than suppression window
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Still suppressed
    expect(testTracker.shouldNotifySubscribers(shapeKey, false)).toBe(false)
  })

  it(`should persist tracked up-to-dates to localStorage`, () => {
    const shapeKey = `https://example.com/v1/shape?table=test`

    // Record an up-to-date
    tracker.shouldNotifySubscribers(shapeKey, false)

    // Check that localStorage was updated
    const storedData = JSON.parse(
      localStorage.getItem(`electric_up_to_date_tracker`) || `{}`
    )
    expect(storedData[shapeKey]).toEqual(expect.any(Number))
    expect(Date.now() - storedData[shapeKey]).toBeLessThan(100) // Should be recent
  })

  it(`should load tracked up-to-dates from localStorage on initialization`, () => {
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

    // Should suppress notification for recently tracked shape
    expect(newTracker.shouldNotifySubscribers(existingShapeKey, false)).toBe(
      false
    )
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

    // Old entry should be cleaned up, so notification should be allowed
    expect(newTracker.shouldNotifySubscribers(oldShapeKey, false)).toBe(true)

    // Recent entry should still be tracked
    expect(newTracker.shouldNotifySubscribers(recentShapeKey, false)).toBe(
      false
    )
  })

  it(`should enforce LRU behavior with max entries`, () => {
    // Create tracker and record many shapes (exceeds max of 250)
    for (let i = 1; i <= 252; i++) {
      tracker.shouldNotifySubscribers(
        `https://example.com/shape?table=table${i}`,
        false
      )
    }

    // The first two shapes should have been evicted
    expect(
      tracker.shouldNotifySubscribers(
        `https://example.com/shape?table=table1`,
        false
      )
    ).toBe(true) // Allowed because it was evicted

    expect(
      tracker.shouldNotifySubscribers(
        `https://example.com/shape?table=table2`,
        false
      )
    ).toBe(true) // Allowed because it was evicted

    // Recent shapes should still be tracked
    expect(
      tracker.shouldNotifySubscribers(
        `https://example.com/shape?table=table251`,
        false
      )
    ).toBe(false) // Suppressed

    expect(
      tracker.shouldNotifySubscribers(
        `https://example.com/shape?table=table252`,
        false
      )
    ).toBe(false) // Suppressed
  })

  it(`should handle localStorage errors gracefully when localStorage is unavailable`, () => {
    const originalLocalStorage = global.localStorage

    // Remove localStorage to simulate unavailability
    delete (global as unknown as { localStorage: unknown }).localStorage

    try {
      // Should not throw when localStorage is unavailable
      expect(() => {
        const trackerWithoutStorage = new UpToDateTracker()
        const testKey = `https://example.com/shape?table=test`

        // Should still work in-memory
        expect(
          trackerWithoutStorage.shouldNotifySubscribers(testKey, false)
        ).toBe(true)
        expect(
          trackerWithoutStorage.shouldNotifySubscribers(testKey, false)
        ).toBe(false)
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
    tracker.shouldNotifySubscribers(shapeKey1, false)
    tracker.shouldNotifySubscribers(shapeKey2, false)

    // Both should be suppressed
    expect(tracker.shouldNotifySubscribers(shapeKey1, false)).toBe(false)
    expect(tracker.shouldNotifySubscribers(shapeKey2, false)).toBe(false)

    // Clear tracker
    tracker.clear()

    // Both should now be allowed
    expect(tracker.shouldNotifySubscribers(shapeKey1, false)).toBe(true)
    expect(tracker.shouldNotifySubscribers(shapeKey2, false)).toBe(true)
  })

  it(`should suppress multiple cached up-to-dates on page refresh`, async () => {
    const notifications: any[] = []

    // Simulate first session: shape gets multiple updates, each ending with up-to-date
    fetchMock
      // Initial sync - data + up-to-date
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
      // Second update - more data + up-to-date (cached for 60s)
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
      // Third update - more data + up-to-date (cached for 60s)
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
      url: `${shapeUrl}?table=test`,
      handle: `test-handle-1`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe((messages) => {
      notifications.push(messages)
    })

    // Wait for requests to complete
    await new Promise((resolve) => setTimeout(resolve, 50))

    // First up-to-date should trigger notification
    expect(notifications.length).toBeGreaterThanOrEqual(1)

    // Second and third up-to-dates should be suppressed
    // We should not see 3 separate notifications
    expect(notifications.length).toBeLessThan(3)
  })

  it(`should track different shapes independently`, () => {
    const shapeKey1 = `https://example.com/v1/shape?table=table1`
    const shapeKey2 = `https://example.com/v1/shape?table=table2`

    // First notification for shape1
    expect(tracker.shouldNotifySubscribers(shapeKey1, false)).toBe(true)

    // First notification for shape2 (different shape)
    expect(tracker.shouldNotifySubscribers(shapeKey2, false)).toBe(true)

    // Second notification for shape1 should be suppressed
    expect(tracker.shouldNotifySubscribers(shapeKey1, false)).toBe(false)

    // Second notification for shape2 should be suppressed
    expect(tracker.shouldNotifySubscribers(shapeKey2, false)).toBe(false)
  })
})
