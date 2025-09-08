import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeStream } from '../src'
import { ExpiredShapesCache } from '../src/expired-shapes-cache'
import { SHAPE_CACHE_BUSTER_QUERY_PARAM } from '../src/constants'

describe(`ExpiredShapesCache`, () => {
  let cache: ExpiredShapesCache
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    cache = new ExpiredShapesCache()
    aborter = new AbortController()
    fetchMock = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => aborter.abort())

  it(`should mark shapes as expired and check expiration status`, () => {
    const shapeUrl1 = `https://example.com/v1/shape?table=test1`
    const shapeUrl2 = `https://example.com/v1/shape?table=test2`

    // Initially, shape should not be expired
    expect(cache.isExpired(shapeUrl1)).toBe(false)

    // Mark shape as expired
    cache.markExpired(shapeUrl1)

    // Now shape should be expired
    expect(cache.isExpired(shapeUrl1)).toBe(true)

    // Different shape should not be expired
    expect(cache.isExpired(shapeUrl2)).toBe(false)
  })

  it(`should persist expired shapes to localStorage`, () => {
    const shapeUrl = `https://example.com/v1/shape?table=test`

    // Mark shape as expired
    cache.markExpired(shapeUrl)

    // Check that localStorage was updated
    const storedData = JSON.parse(
      localStorage.getItem(`electric_expired_shapes`) || `{}`
    )
    expect(storedData[shapeUrl]).toEqual({
      expired: true,
      time: expect.any(Number),
    })
  })

  it(`should load expired shapes from localStorage on initialization`, () => {
    const existingShapeUrl = `https://example.com/v1/shape?table=existing`
    const nonExistentShapeUrl = `https://example.com/v1/shape?table=nonexistent`

    // Pre-populate localStorage with expired shape data
    const existingData = {
      [existingShapeUrl]: {
        expired: true,
        time: Date.now(),
      },
    }
    localStorage.setItem(
      `electric_expired_shapes`,
      JSON.stringify(existingData)
    )

    // Create new cache - this should load from localStorage
    const newCache = new ExpiredShapesCache()

    // Should recognize previously expired shape
    expect(newCache.isExpired(existingShapeUrl)).toBe(true)
    expect(newCache.isExpired(nonExistentShapeUrl)).toBe(false)
  })

  it(`should add cache buster parameter for expired shapes in URL construction`, async () => {
    let capturedUrl: string = ``

    const expectedShapeUrl = `${shapeUrl}?table=test`

    // Pre-mark the shape URL as expired in localStorage
    cache.markExpired(expectedShapeUrl)

    fetchMock.mockImplementation((url: string) => {
      capturedUrl = url
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'electric-handle': `test-handle-1`,
            'electric-offset': `0`,
            'electric-schema': `{}`,
            'electric-cursor': `cursor-1`,
          },
        })
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: `test-handle-1`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    // Trigger a request by subscribing
    stream.subscribe(() => {})

    // Wait for the fetch to be called
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    // Verify cache buster parameter was added to the URL
    const parsedUrl = new URL(capturedUrl)
    expect(parsedUrl.searchParams.has(SHAPE_CACHE_BUSTER_QUERY_PARAM)).toBe(
      true
    )
    expect(parsedUrl.searchParams.get(SHAPE_CACHE_BUSTER_QUERY_PARAM)).toBe(
      `expired`
    )
  })

  it(`should enforce LRU behavior with max cache size`, async () => {
    // Mark 252 shapes as expired (exceeds max of 250)
    for (let i = 1; i <= 252; i++) {
      cache.markExpired(`handle-${i}`)
      // Small delay to ensure different timestamps
      if (i % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 1))
    }

    // The first two handles should have been evicted due to LRU
    expect(cache.isExpired(`handle-1`)).toBe(false)
    expect(cache.isExpired(`handle-2`)).toBe(false)

    // Recent handles should still be expired
    expect(cache.isExpired(`handle-251`)).toBe(true)
    expect(cache.isExpired(`handle-252`)).toBe(true)
  })

  it(`should handle localStorage errors gracefully when localStorage is unavailable`, () => {
    const originalLocalStorage = global.localStorage

    // Remove localStorage to simulate unavailability
    delete (global as unknown as { localStorage: unknown }).localStorage

    try {
      // Should not throw when localStorage is unavailable
      expect(() => {
        const cacheWithoutStorage = new ExpiredShapesCache()
        cacheWithoutStorage.markExpired(`test-handle-1`)
        expect(cacheWithoutStorage.isExpired(`test-handle-1`)).toBe(true) // Should work in memory
      }).not.toThrow()
    } finally {
      // Restore localStorage
      global.localStorage = originalLocalStorage
    }
  })

  it(`should store expired shape when 409 response occurs`, async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(`[]`, {
          status: 409,
          headers: {
            'electric-handle': `new-handle`,
          },
        })
      )
      .mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            'electric-handle': `new-handle`,
            'electric-offset': `0`,
            'electric-schema': `{}`,
            'electric-cursor': `cursor-1`,
          },
        })
      )

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: `original-handle`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    // Subscribe to trigger the request
    stream.subscribe(() => {})

    // Wait for the 409 to be processed and localStorage to be updated
    await vi.waitFor(
      () => {
        const storedData = JSON.parse(
          localStorage.getItem(`electric_expired_shapes`) || `{}`
        )
        expect(storedData[`original-handle`]).toEqual({
          expired: true,
          time: expect.any(Number),
        })
      },
      { timeout: 1000 }
    )

    // Also verify using a new cache instance (tests persistence)
    const newCache = new ExpiredShapesCache()
    expect(newCache.isExpired(`original-handle`)).toBe(true)
  })
})
