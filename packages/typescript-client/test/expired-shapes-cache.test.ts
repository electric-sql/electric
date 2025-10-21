import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { ShapeStream } from "../src"
import {
  ExpiredShapesCache,
  expiredShapesCache,
} from "../src/expired-shapes-cache"
import { EXPIRED_HANDLE_QUERY_PARAM } from "../src/constants"

function waitForFetch(stream: ShapeStream): Promise<void> {
  let unsub = () => {}
  return new Promise<void>((resolve) => {
    unsub = stream.subscribe(
      () => resolve(),
      () => resolve()
    )
  }).finally(() => unsub())
}

describe("ExpiredShapesCache", () => {
  let cache: ExpiredShapesCache
  const shapeUrl = "https://example.com/v1/shape"
  let aborter: AbortController
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    cache = new ExpiredShapesCache()
    expiredShapesCache.clear()
    aborter = new AbortController()
    fetchMock = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(() => aborter.abort())

  it("should mark shapes as expired and check expiration status", () => {
    const shapeUrl1 = "https://example.com/v1/shape?table=test1"
    const shapeUrl2 = "https://example.com/v1/shape?table=test2"
    const handle1 = "handle-123"

    // Initially, shape should not have expired handle
    expect(cache.getExpiredHandle(shapeUrl1)).toBe(null)

    // Mark shape as expired
    cache.markExpired(shapeUrl1, handle1)

    // Now shape should return expired handle
    expect(cache.getExpiredHandle(shapeUrl1)).toBe(handle1)

    // Different shape should not have expired handle
    expect(cache.getExpiredHandle(shapeUrl2)).toBe(null)
  })

  it("should persist expired shapes to localStorage", () => {
    const shapeUrl = "https://example.com/v1/shape?table=test"
    const handle = "test-handle"

    // Mark shape as expired
    cache.markExpired(shapeUrl, handle)

    // Check that localStorage was updated
    const storedData = JSON.parse(
      localStorage.getItem("electric_expired_shapes") || "{}"
    )
    expect(storedData[shapeUrl]).toEqual({
      expiredHandle: handle,
      lastUsed: expect.any(Number),
    })
  })

  it("should load expired shapes from localStorage on initialization", () => {
    const existingShapeUrl = "https://example.com/v1/shape?table=existing"
    const nonExistentShapeUrl = "https://example.com/v1/shape?table=nonexistent"
    const existingHandle = "existing-handle"

    // Pre-populate localStorage with expired shape data
    const existingData = {
      [existingShapeUrl]: {
        expiredHandle: existingHandle,
        lastUsed: Date.now(),
      },
    }
    localStorage.setItem(
      "electric_expired_shapes",
      JSON.stringify(existingData)
    )

    // Create new cache - this should load from localStorage
    const newCache = new ExpiredShapesCache()

    // Should recognize previously expired shape
    expect(newCache.getExpiredHandle(existingShapeUrl)).toBe(existingHandle)
    expect(newCache.getExpiredHandle(nonExistentShapeUrl)).toBe(null)
  })

  it("should add cache buster parameter for expired shapes in URL construction", async () => {
    let capturedUrl: string = ""

    const expectedShapeUrl = `${shapeUrl}?table=test`

    // Pre-mark the shape URL as expired using the singleton
    const expiredHandle = "expired-handle-123"
    expiredShapesCache.markExpired(expectedShapeUrl, expiredHandle)

    fetchMock.mockImplementation((url: string) => {
      capturedUrl = url
      aborter.abort()
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            "electric-handle": "test-handle-1",
            "electric-offset": "0",
            "electric-schema": "{}",
            "electric-cursor": "cursor-1",
          },
        })
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: "test" },
      handle: "test-handle-1",
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    const unsubscribe = stream.subscribe((update) => console.log(update))

    await new Promise((resolve) => setTimeout(resolve, 1))
    unsubscribe()

    // Wait for the initial fetch to complete
    // await waitForFetch(stream)

    // Verify expired handle parameter was added to the URL
    const parsedUrl = new URL(capturedUrl)
    expect(parsedUrl.searchParams.has(EXPIRED_HANDLE_QUERY_PARAM)).toBe(true)
    expect(parsedUrl.searchParams.get(EXPIRED_HANDLE_QUERY_PARAM)).toBe(
      expiredHandle
    )
  })

  it("should enforce LRU behavior with max cache size", () => {
    // Mark 252 shapes as expired (exceeds max of 250)
    for (let i = 1; i <= 252; i++) {
      cache.markExpired(
        `https://example.com/shape?table=table${i}`,
        `handle-${i}`
      )
    }

    // The first two handles should have been evicted due to LRU
    expect(
      cache.getExpiredHandle("https://example.com/shape?table=table1")
    ).toBe(null)
    expect(
      cache.getExpiredHandle("https://example.com/shape?table=table2")
    ).toBe(null)

    // Recent handles should still be expired
    expect(
      cache.getExpiredHandle("https://example.com/shape?table=table251")
    ).toBe("handle-251")
    expect(
      cache.getExpiredHandle("https://example.com/shape?table=table252")
    ).toBe("handle-252")
  })

  it("should handle localStorage errors gracefully when localStorage is unavailable", () => {
    const originalLocalStorage = global.localStorage

    // Remove localStorage to simulate unavailability
    delete (global as unknown as { localStorage: unknown }).localStorage

    try {
      // Should not throw when localStorage is unavailable
      expect(() => {
        const cacheWithoutStorage = new ExpiredShapesCache()
        const testUrl = "https://example.com/shape?table=test"
        const testHandle = "test-handle-1"
        cacheWithoutStorage.markExpired(testUrl, testHandle)
        expect(cacheWithoutStorage.getExpiredHandle(testUrl)).toBe(testHandle) // Should work in memory
      }).not.toThrow()
    } finally {
      // Restore localStorage
      global.localStorage = originalLocalStorage
    }
  })

  it("should store expired shape when 409 response occurs", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response("[]", {
          status: 409,
          headers: {
            "electric-handle": "new-handle",
          },
        })
      )
      .mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: {
            "electric-handle": "new-handle",
            "electric-offset": "0",
            "electric-schema": "{}",
            "electric-cursor": "cursor-1",
          },
        })
      )

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: "test" },
      handle: "original-handle",
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    // Wait for the initial fetch and 409 response to be processed
    await waitForFetch(stream)

    // Verify localStorage was updated after 409
    const expectedShapeUrl = `${shapeUrl}?table=test`
    const storedData = JSON.parse(
      localStorage.getItem("electric_expired_shapes") || "{}"
    )
    expect(storedData[expectedShapeUrl]).toEqual({
      expiredHandle: "original-handle",
      lastUsed: expect.any(Number),
    })

    // Also verify using the singleton cache (tests persistence)
    expect(expiredShapesCache.getExpiredHandle(expectedShapeUrl)).toBe(
      "original-handle"
    )
  })
})
