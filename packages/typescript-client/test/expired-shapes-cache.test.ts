import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ShapeStream } from '../src'
import {
  ExpiredShapesCache,
  expiredShapesCache,
} from '../src/expired-shapes-cache'
import {
  CACHE_BUSTER_QUERY_PARAM,
  EXPIRED_HANDLE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
} from '../src/constants'

function waitForFetch(stream: ShapeStream): Promise<void> {
  let unsub = () => {}
  return new Promise<void>((resolve) => {
    unsub = stream.subscribe(
      () => resolve(),
      () => resolve()
    )
  }).finally(() => unsub())
}

describe(`ExpiredShapesCache`, () => {
  let cache: ExpiredShapesCache
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController
  let fetchMock: ReturnType<
    typeof vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >
  >

  beforeEach(() => {
    localStorage.clear()
    cache = new ExpiredShapesCache()
    expiredShapesCache.clear()
    aborter = new AbortController()
    fetchMock =
      vi.fn<
        (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      >()
    vi.clearAllMocks()
  })

  afterEach(() => aborter.abort())

  it(`should mark shapes as expired and check expiration status`, () => {
    const shapeUrl1 = `https://example.com/v1/shape?table=test1`
    const shapeUrl2 = `https://example.com/v1/shape?table=test2`
    const handle1 = `handle-123`

    // Initially, shape should not have expired handle
    expect(cache.getExpiredHandle(shapeUrl1)).toBe(null)

    // Mark shape as expired
    cache.markExpired(shapeUrl1, handle1)

    // Now shape should return expired handle
    expect(cache.getExpiredHandle(shapeUrl1)).toBe(handle1)

    // Different shape should not have expired handle
    expect(cache.getExpiredHandle(shapeUrl2)).toBe(null)
  })

  it(`should persist expired shapes to localStorage`, () => {
    const shapeUrl = `https://example.com/v1/shape?table=test`
    const handle = `test-handle`

    // Mark shape as expired
    cache.markExpired(shapeUrl, handle)

    // Check that localStorage was updated
    const storedData = JSON.parse(
      localStorage.getItem(`electric_expired_shapes`) || `{}`
    )
    expect(storedData[shapeUrl]).toEqual({
      expiredHandle: handle,
      lastUsed: expect.any(Number),
    })
  })

  it(`should load expired shapes from localStorage on initialization`, () => {
    const existingShapeUrl = `https://example.com/v1/shape?table=existing`
    const nonExistentShapeUrl = `https://example.com/v1/shape?table=nonexistent`
    const existingHandle = `existing-handle`

    // Pre-populate localStorage with expired shape data
    const existingData = {
      [existingShapeUrl]: {
        expiredHandle: existingHandle,
        lastUsed: Date.now(),
      },
    }
    localStorage.setItem(
      `electric_expired_shapes`,
      JSON.stringify(existingData)
    )

    // Create new cache - this should load from localStorage
    const newCache = new ExpiredShapesCache()

    // Should recognize previously expired shape
    expect(newCache.getExpiredHandle(existingShapeUrl)).toBe(existingHandle)
    expect(newCache.getExpiredHandle(nonExistentShapeUrl)).toBe(null)
  })

  it(`should add cache buster parameter for expired shapes in URL construction`, async () => {
    let capturedUrl: string = ``

    const expectedShapeUrl = `${shapeUrl}?table=test`

    // Pre-mark the shape URL as expired using the singleton
    const expiredHandle = `expired-handle-123`
    expiredShapesCache.markExpired(expectedShapeUrl, expiredHandle)

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      capturedUrl = input.toString()
      aborter.abort()
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

  it(`should enforce LRU behavior with max cache size`, () => {
    // Mark 252 shapes as expired (exceeds max of 250)
    for (let i = 1; i <= 252; i++) {
      cache.markExpired(
        `https://example.com/shape?table=table${i}`,
        `handle-${i}`
      )
    }

    // The first two handles should have been evicted due to LRU
    expect(
      cache.getExpiredHandle(`https://example.com/shape?table=table1`)
    ).toBe(null)
    expect(
      cache.getExpiredHandle(`https://example.com/shape?table=table2`)
    ).toBe(null)

    // Recent handles should still be expired
    expect(
      cache.getExpiredHandle(`https://example.com/shape?table=table251`)
    ).toBe(`handle-251`)
    expect(
      cache.getExpiredHandle(`https://example.com/shape?table=table252`)
    ).toBe(`handle-252`)
  })

  it(`should handle localStorage errors gracefully when localStorage is unavailable`, () => {
    const originalLocalStorage = global.localStorage

    // Remove localStorage to simulate unavailability
    delete (global as unknown as { localStorage: unknown }).localStorage

    try {
      // Should not throw when localStorage is unavailable
      expect(() => {
        const cacheWithoutStorage = new ExpiredShapesCache()
        const testUrl = `https://example.com/shape?table=test`
        const testHandle = `test-handle-1`
        cacheWithoutStorage.markExpired(testUrl, testHandle)
        expect(cacheWithoutStorage.getExpiredHandle(testUrl)).toBe(testHandle) // Should work in memory
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

    // Wait for the initial fetch and 409 response to be processed
    await waitForFetch(stream)

    // Verify localStorage was updated after 409
    const expectedShapeUrl = `${shapeUrl}?table=test`
    const storedData = JSON.parse(
      localStorage.getItem(`electric_expired_shapes`) || `{}`
    )
    expect(storedData[expectedShapeUrl]).toEqual({
      expiredHandle: `original-handle`,
      lastUsed: expect.any(Number),
    })

    // Also verify using the singleton cache (tests persistence)
    expect(expiredShapesCache.getExpiredHandle(expectedShapeUrl)).toBe(
      `original-handle`
    )
  })

  it(`should not accept expired handle from stale cached response after 409`, async () => {
    // This test simulates the infinite loop bug:
    // 1. Client has handle H1, server returns 409 with new handle H2
    // 2. Client marks H1 as expired, resets to H2, makes new request
    // 3. Proxy returns stale cached response with H1 in headers
    // 4. Bug: Client accepts H1, causing infinite 409 loop
    // Fix: Client should ignore expired handle from response

    let requestCount = 0
    const capturedHandles: string[] = []
    let resolveSecondRequest: () => void
    const secondRequestMade = new Promise<void>((resolve) => {
      resolveSecondRequest = resolve
    })

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      requestCount++
      const url = new URL(input.toString())
      const handle = url.searchParams.get(`handle`)
      capturedHandles.push(handle || `none`)

      if (requestCount === 1) {
        // First request: return 409 with new handle
        return Promise.resolve(
          new Response(`[]`, {
            status: 409,
            headers: {
              'electric-handle': `new-handle-H2`,
            },
          })
        )
      } else if (requestCount === 2) {
        // Second request: simulate stale cached response returning OLD expired handle
        // This is the bug scenario - proxy ignores cache buster and returns stale response
        resolveSecondRequest()
        return Promise.resolve(
          new Response(
            JSON.stringify([{ headers: { control: `up-to-date` } }]),
            {
              status: 200,
              headers: {
                'electric-handle': `original-handle-H1`, // OLD handle from cached response!
                'electric-offset': `0_0`,
                'electric-schema': `{}`,
                'electric-cursor': `cursor-1`,
              },
            }
          )
        )
      } else {
        // Third+ request: if client incorrectly accepted H1, it would 409 again
        // If fixed, client should keep H2 and this shouldn't happen
        if (handle === `original-handle-H1`) {
          // This means the bug occurred - client accepted the expired handle
          return Promise.resolve(
            new Response(`[]`, {
              status: 409,
              headers: {
                'electric-handle': `new-handle-H3`,
              },
            })
          )
        }
        // Normal response for H2
        aborter.abort()
        return Promise.resolve(
          new Response(
            JSON.stringify([{ headers: { control: `up-to-date` } }]),
            {
              status: 200,
              headers: {
                'electric-handle': `new-handle-H2`,
                'electric-offset': `0_0`,
                'electric-schema': `{}`,
                'electric-cursor': `cursor-1`,
                'electric-up-to-date': ``,
              },
            }
          )
        )
      }
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: `original-handle-H1`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    // Subscribe to trigger fetching
    stream.subscribe(() => {})

    // Wait for the second request to be made (after 409 handling)
    await secondRequestMade

    // Wait for the stale response to trigger stale-retry and the third request to complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    // After 409, the expired handle should be stored
    const expectedShapeUrl = `${shapeUrl}?table=test`
    expect(expiredShapesCache.getExpiredHandle(expectedShapeUrl)).toBe(
      `original-handle-H1`
    )

    // The client should have made exactly 3 requests:
    // 1. Original request with H1 -> 409
    // 2. New request with H2 -> 200 (but response has stale H1 in header -> stale-retry with cache buster)
    // 3. Retry with H2 + cache buster -> 200 with correct H2 header -> processed
    expect(requestCount).toBe(3)
    expect(capturedHandles).toEqual([
      `original-handle-H1`,
      `new-handle-H2`,
      `new-handle-H2`,
    ])

    // Verify the stream's current handle is H2 (not the stale H1)
    expect(stream.shapeHandle).toBe(`new-handle-H2`)
  })

  it(`should retry with cache buster when receiving stale response with no handle yet`, async () => {
    // This test verifies the fix for a bug where the client gets into a broken state:
    // 1. Client starts fresh (no handle, offset=-1)
    // 2. expiredShapesCache has a stale expired handle from a previous session
    // 3. CDN returns cached response with that expired handle in headers
    // 4. Bug: Client didn't accept the handle because it matched expired cache
    // 5. Bug: Offset advanced but handle stayed undefined
    // 6. Bug: Next request failed with "handle can't be blank when offset != -1"
    // Fix: Client retries with a random cache buster to bypass the CDN cache

    const expectedShapeUrl = `${shapeUrl}?table=test`
    const staleHandle = `stale-handle-from-previous-session`
    const freshHandle = `fresh-handle-from-origin`

    // Pre-populate expiredShapesCache with stale expired handle data
    // (simulating leftover from previous browser session)
    expiredShapesCache.markExpired(expectedShapeUrl, staleHandle)

    let requestCount = 0
    const capturedUrls: string[] = []
    let resolveSecondRequest: () => void
    const secondRequestMade = new Promise<void>((resolve) => {
      resolveSecondRequest = resolve
    })

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      requestCount++
      capturedUrls.push(input.toString())

      if (requestCount === 1) {
        // First request: CDN returns stale cached response with the expired handle
        // This simulates proxy/CDN ignoring the expired_handle cache buster
        return Promise.resolve(
          new Response(JSON.stringify([{ value: { id: 1 } }]), {
            status: 200,
            headers: {
              'electric-handle': staleHandle, // Same as expired handle!
              'electric-offset': `0_0`,
              'electric-schema': `{"id":"int4"}`,
              'electric-cursor': `cursor-1`,
            },
          })
        )
      } else {
        // Second request: should include random cache buster (_cb param)
        // and get fresh response from origin
        resolveSecondRequest()
        return Promise.resolve(
          new Response(
            JSON.stringify([{ headers: { control: `up-to-date` } }]),
            {
              status: 200,
              headers: {
                'electric-handle': freshHandle, // Fresh handle from origin
                'electric-offset': `0_0`,
                'electric-schema': `{"id":"int4"}`,
                'electric-cursor': `cursor-2`,
              },
            }
          )
        )
      }
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      // NO handle provided - client starts fresh
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    // Subscribe to trigger fetching
    stream.subscribe(() => {})

    // Wait for second request to be made
    await secondRequestMade

    // Small delay to let the response be processed
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The client should have retried and gotten a fresh handle
    expect(stream.shapeHandle).toBe(freshHandle)

    // Verify the second request includes the cache buster parameter
    expect(requestCount).toBeGreaterThanOrEqual(2)
    const secondUrl = new URL(capturedUrls[1])
    expect(secondUrl.searchParams.has(CACHE_BUSTER_QUERY_PARAM)).toBe(true)

    // The key assertion: client should NOT be in a broken state
    expect(stream.shapeHandle).not.toBe(undefined)
  })

  it(`should not update offset from stale response when client already has a handle`, async () => {
    // Regression test: When CDN returns a stale response with an expired handle,
    // the client should ignore the entire response (including body) to prevent
    // a mismatch between handle and offset that would cause server errors.

    const expiredHandle = `expired-handle-A`
    const currentHandle = `current-handle-B`
    const originalOffset = `0_0`

    expiredShapesCache.markExpired(`${shapeUrl}?table=test`, expiredHandle)

    let fetchCount = 0
    fetchMock.mockImplementation(() => {
      fetchCount++
      if (fetchCount >= 3) aborter.abort()
      return Promise.resolve(
        new Response(JSON.stringify([{ headers: { control: `up-to-date` } }]), {
          status: 200,
          headers: {
            'electric-handle': expiredHandle,
            'electric-offset': `0_inf`, // Different offset from stale response
            'electric-schema': `{"id":"int4"}`,
            'electric-cursor': `cursor-1`,
          },
        })
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: currentHandle,
      offset: originalOffset,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    // Wait for the fetch cycles to complete (aborts after 3 fetches)
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Stale responses should be fully ignored — handle and offset unchanged
    expect(stream.shapeHandle).toBe(currentHandle)
    expect(stream.lastOffset).toBe(originalOffset)
    expect(fetchCount).toBeGreaterThanOrEqual(3)
  })

  it(`should self-heal after stale cache retries by clearing expired entry and retrying`, async () => {
    // This test verifies the full stale-retry + self-healing flow:
    // 1. CDN serves stale response with expired handle (3 retries with cache busters)
    // 2. After retries exhaust, expired entry is cleared and self-healing retry fires
    // 3. Self-healing request has no expired_handle param, gets fresh response
    const expectedShapeUrl = `${shapeUrl}?table=test`
    const staleHandle = `persistent-stale-handle`

    // Pre-populate expiredShapesCache with stale expired handle data
    expiredShapesCache.markExpired(expectedShapeUrl, staleHandle)

    let requestCount = 0
    const capturedUrls: string[] = []

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      requestCount++
      const urlStr = input.toString()
      capturedUrls.push(urlStr)

      const url = new URL(urlStr)
      if (!url.searchParams.has(EXPIRED_HANDLE_QUERY_PARAM)) {
        // Self-healing retry: no expired_handle param, return fresh response
        return Promise.resolve(
          new Response(
            JSON.stringify([{ headers: { control: `up-to-date` } }]),
            {
              status: 200,
              headers: {
                'electric-handle': `fresh-handle`,
                'electric-offset': `0_0`,
                'electric-schema': `{"id":"int4"}`,
                'electric-up-to-date': ``,
              },
            }
          )
        )
      }

      // Stale response while expired_handle param is present (CDN serving old data)
      return Promise.resolve(
        new Response(JSON.stringify([{ value: { id: 1 } }]), {
          status: 200,
          headers: {
            'electric-handle': staleHandle, // Always stale!
            'electric-offset': `0_0`,
            'electric-schema': `{"id":"int4"}`,
            'electric-cursor': `cursor-1`,
          },
        })
      )
    })

    let caughtError: Error | null = null

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
      onError: (error) => {
        caughtError = error
      },
    })

    // Subscribe to trigger fetching
    stream.subscribe(() => {})

    // Wait for retries + self-healing
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Should have made initial request + 3 stale retries + 1 self-healing = 5
    expect(requestCount).toBe(5)

    // First 4 requests should have expired_handle param
    for (let i = 0; i < 4; i++) {
      const url = new URL(capturedUrls[i])
      expect(url.searchParams.get(EXPIRED_HANDLE_QUERY_PARAM)).toBe(staleHandle)
    }

    // Retries (requests 2-4) should include cache buster
    for (let i = 1; i < 4; i++) {
      const url = new URL(capturedUrls[i])
      expect(url.searchParams.has(CACHE_BUSTER_QUERY_PARAM)).toBe(true)
    }

    // Self-healing request (5th) should be a fresh start: no expired_handle,
    // no handle, and offset reset to -1
    const selfHealingUrl = new URL(capturedUrls[4])
    expect(selfHealingUrl.searchParams.has(EXPIRED_HANDLE_QUERY_PARAM)).toBe(
      false
    )
    expect(selfHealingUrl.searchParams.has(SHAPE_HANDLE_QUERY_PARAM)).toBe(
      false
    )
    expect(selfHealingUrl.searchParams.get(OFFSET_QUERY_PARAM)).toBe(`-1`)

    // Expired entry should have been cleared
    expect(expiredShapesCache.getExpiredHandle(expectedShapeUrl)).toBeNull()

    // No error — self-healing succeeded
    expect(caughtError).toBe(null)
  })

  it(`should clear expired entry and attempt self-healing even when CDN always returns stale handle`, async () => {
    // When CDN caches by path only (ignoring all query params), even the
    // self-healing retry gets the expired handle back. Verify that
    // self-healing still fires and the expired entry is cleared.
    // (The eventual fast-loop error is tested separately in stream.test.ts)
    const expectedShapeUrl = `${shapeUrl}?table=test`
    const staleHandle = `persistent-stale-handle`

    expiredShapesCache.markExpired(expectedShapeUrl, staleHandle)

    const capturedUrls: string[] = []

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      capturedUrls.push(input.toString())

      // CDN always returns stale handle regardless of query params
      return Promise.resolve(
        new Response(JSON.stringify([{ value: { id: 1 } }]), {
          status: 200,
          headers: {
            'electric-handle': staleHandle,
            'electric-offset': `0_0`,
            'electric-schema': `{"id":"int4"}`,
            'electric-cursor': `cursor-1`,
          },
        })
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    // Wait long enough for stale retries + self-healing to fire
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Self-healing should have been attempted (a request without expired_handle)
    const selfHealingFired = capturedUrls.some(
      (url) => !new URL(url).searchParams.has(EXPIRED_HANDLE_QUERY_PARAM)
    )
    expect(selfHealingFired).toBe(true)

    // Expired entry should be cleared
    expect(expiredShapesCache.getExpiredHandle(expectedShapeUrl)).toBeNull()
  })

  it(`client should retry with cache buster when local handle matches expired handle`, async () => {
    // When the client's own persisted handle IS the expired handle,
    // the client should detect that localHandle === expiredHandle and
    // use stale-retry (with cache buster) to bypass the stale CDN cache.

    const expiredHandle = `expired-H1`
    const freshHandle = `fresh-H2`
    const expectedShapeUrl = `${shapeUrl}?table=test`
    expiredShapesCache.markExpired(expectedShapeUrl, expiredHandle)

    let fetchCount = 0
    const capturedUrls: string[] = []

    fetchMock.mockImplementation(
      (input: RequestInfo | URL, _init?: RequestInit) => {
        fetchCount++
        const url = input.toString()
        capturedUrls.push(url)

        const hasCacheBuster = new URL(url).searchParams.has(
          CACHE_BUSTER_QUERY_PARAM
        )

        // Once the client sends a cache buster, the CDN is bypassed
        // and the backend returns a fresh handle
        const handle = hasCacheBuster ? freshHandle : expiredHandle

        // Abort after recovery to prevent infinite live polling loop
        if (fetchCount >= 5) {
          aborter.abort()
        }

        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: {
              'electric-handle': handle,
              'electric-offset': `0_0`,
              'electric-schema': `{}`,
              'electric-cursor': `cursor-1`,
              'electric-up-to-date': ``,
            },
          })
        )
      }
    )

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: expiredHandle, // client's own handle IS the expired one
      offset: `0_0`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    await new Promise((resolve) => setTimeout(resolve, 200))

    // The client should have used a cache buster to escape the stale CDN
    const usedCacheBuster = capturedUrls.some((url) =>
      new URL(url).searchParams.has(CACHE_BUSTER_QUERY_PARAM)
    )
    expect(usedCacheBuster).toBe(true)
  })

  it(`client should use cache buster for stale response even when local handle exists`, async () => {
    // Scenario:
    // 1. Client resumes from persisted handle/offset (schema is undefined)
    // 2. The expired shapes cache has 'stale-handle' marked as expired
    // 3. First fetch returns a stale response with data messages
    // 4. checkStaleResponse enters stale-retry (adds cache buster)
    // 5. Client retries with cache buster to bypass CDN
    // 6. After max retries, self-healing clears the entry and retries
    // 7. Self-healing request gets fresh response and succeeds

    const expectedShapeUrl = `${shapeUrl}?table=test`
    expiredShapesCache.markExpired(expectedShapeUrl, `stale-handle`)

    const capturedUrls: string[] = []

    fetchMock.mockImplementation(
      (input: RequestInfo | URL, _init?: RequestInit) => {
        const urlStr = input.toString()
        capturedUrls.push(urlStr)

        const url = new URL(urlStr)
        if (!url.searchParams.has(EXPIRED_HANDLE_QUERY_PARAM)) {
          // Self-healing retry: return fresh response
          return Promise.resolve(
            new Response(
              JSON.stringify([{ headers: { control: `up-to-date` } }]),
              {
                status: 200,
                headers: {
                  'electric-handle': `fresh-handle`,
                  'electric-offset': `0_0`,
                  'electric-schema': JSON.stringify({
                    id: { type: `text` },
                    name: { type: `text` },
                  }),
                  'electric-up-to-date': ``,
                },
              }
            )
          )
        }

        return Promise.resolve(
          new Response(`[]`, {
            status: 200,
            headers: {
              'electric-handle': `stale-handle`,
              'electric-offset': `0_0`,
              'electric-schema': JSON.stringify({
                id: { type: `text` },
                name: { type: `text` },
              }),
              'electric-cursor': `123`,
            },
          })
        )
      }
    )

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: `my-persisted-handle`,
      offset: `0_0`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Should have used cache busters to try to bypass stale CDN
    const usedCacheBuster = capturedUrls.some((url) =>
      new URL(url).searchParams.has(CACHE_BUSTER_QUERY_PARAM)
    )
    expect(usedCacheBuster).toBe(true)

    // Expired entry should have been cleared by self-healing
    expect(expiredShapesCache.getExpiredHandle(expectedShapeUrl)).toBeNull()
  })

  it(`should use cache buster instead of handle mutation on 409 without handle header`, async () => {
    // Regression test for ELECTRIC-4GV: When a proxy strips the handle header
    // from 409 responses, the client must use a random cache-buster query param
    // to ensure unique URLs on retries, rather than mutating the handle.

    let requestCount = 0
    const capturedUrls: string[] = []
    const maxRequests = 10

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      requestCount++
      capturedUrls.push(input.toString())

      if (requestCount >= maxRequests) {
        aborter.abort()
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: {
              'electric-handle': `final-handle`,
              'electric-offset': `0_0`,
              'electric-schema': `{}`,
              'electric-cursor': `cursor-1`,
            },
          })
        )
      }

      // Return 409 WITHOUT a handle header — simulating a proxy that strips it
      return Promise.resolve(
        new Response(`[]`, {
          status: 409,
        })
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      handle: `original-handle`,
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    await new Promise((resolve) => setTimeout(resolve, 500))

    // Invariant: no URL should contain "-next" in any parameter
    for (const urlStr of capturedUrls) {
      expect(urlStr, `URL contains "-next": ${urlStr}`).not.toContain(`-next`)
    }

    // Invariant: after the first 409, retries should include a cache-buster param
    const urlsAfterFirst = capturedUrls.slice(1)
    for (const urlStr of urlsAfterFirst) {
      const url = new URL(urlStr)
      const hasCacheBuster = url.searchParams.has(`cache-buster`)
      const hasExpiredHandle = url.searchParams.has(`expired_handle`)
      // URL uniqueness comes from either cache-buster or expired_handle
      expect(
        hasCacheBuster || hasExpiredHandle,
        `Retry URL lacks cache-buster and expired_handle: ${urlStr}`
      ).toBe(true)
    }

    // Invariant: all retry URLs must be unique (no identical URLs)
    const uniqueUrls = new Set(capturedUrls)
    expect(
      uniqueUrls.size,
      `Expected ${capturedUrls.length} unique URLs but got ${uniqueUrls.size}`
    ).toBe(capturedUrls.length)
  })

  it(`should use cache buster on 409 without handle header when initial handle is undefined`, async () => {
    // Regression test for ELECTRIC-4GV Pattern A: client never received a
    // valid handle. Previously produced "undefined-next-next-next..." because
    // the non-null assertion stringified undefined.

    let requestCount = 0
    const capturedUrls: string[] = []
    const maxRequests = 10

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      requestCount++
      capturedUrls.push(input.toString())

      if (requestCount >= maxRequests) {
        aborter.abort()
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: {
              'electric-handle': `final-handle`,
              'electric-offset': `0_0`,
              'electric-schema': `{}`,
              'electric-cursor': `cursor-1`,
            },
          })
        )
      }

      // Return 409 WITHOUT a handle header
      return Promise.resolve(
        new Response(`[]`, {
          status: 409,
        })
      )
    })

    // No handle provided — simulates a client that never received one
    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    stream.subscribe(() => {})

    await new Promise((resolve) => setTimeout(resolve, 500))

    // Invariant: no URL should contain "undefined" or "-next"
    for (const urlStr of capturedUrls) {
      expect(urlStr, `URL contains "undefined": ${urlStr}`).not.toContain(
        `undefined`
      )
      expect(urlStr, `URL contains "-next": ${urlStr}`).not.toContain(`-next`)
    }

    // Invariant: all retry URLs must be unique
    const uniqueUrls = new Set(capturedUrls)
    expect(
      uniqueUrls.size,
      `Expected ${capturedUrls.length} unique URLs but got ${uniqueUrls.size}`
    ).toBe(capturedUrls.length)
  })

  it(`should preserve stream retry cache buster when fetchSnapshot runs before the retry`, async () => {
    const streamUrls: string[] = []
    const snapshotUrls: string[] = []
    let streamRequestCount = 0
    let snapshotStarted = false

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()
      const parsedUrl = new URL(url)
      const isSnapshotRequest =
        parsedUrl.searchParams.has(`subset__limit`) ||
        parsedUrl.searchParams.has(`subset__order_by`)

      if (isSnapshotRequest) {
        snapshotUrls.push(url)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              metadata: {},
              data: [],
            }),
            {
              status: 200,
              headers: {
                'content-type': `application/json`,
                'electric-schema': `{}`,
                'electric-handle': `snapshot-handle`,
                'electric-offset': `0_0`,
              },
            }
          )
        )
      }

      streamRequestCount++
      streamUrls.push(url)

      if (streamRequestCount === 1) {
        return Promise.resolve(
          new Response(`[]`, {
            status: 409,
          })
        )
      }

      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              headers: { control: `up-to-date` },
              offset: `0_0`,
            },
          ]),
          {
            status: 200,
            headers: {
              'electric-handle': `final-handle`,
              'electric-offset': `0_0`,
              'electric-schema': `{}`,
              'electric-cursor': `cursor-1`,
            },
          }
        )
      )
    })

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
      log: `changes_only`,
    })

    const snapshotFinished = new Promise<void>((resolve, reject) => {
      stream.subscribe(async () => {
        if (snapshotStarted) return
        snapshotStarted = true

        try {
          await stream.fetchSnapshot({
            orderBy: `id ASC`,
            limit: 1,
          })
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })

    await snapshotFinished

    await vi.waitFor(() => {
      expect(
        streamUrls
          .slice(1)
          .some((url) =>
            new URL(url).searchParams.has(CACHE_BUSTER_QUERY_PARAM)
          )
      ).toBe(true)
    })

    expect(snapshotUrls.length).toBeGreaterThan(0)

    const streamRetryUrl = new URL(
      streamUrls.find((url) =>
        new URL(url).searchParams.has(CACHE_BUSTER_QUERY_PARAM)
      )!
    )
    const snapshotHasCacheBuster = snapshotUrls.some((url) =>
      new URL(url).searchParams.has(CACHE_BUSTER_QUERY_PARAM)
    )

    expect(streamRetryUrl.searchParams.has(CACHE_BUSTER_QUERY_PARAM)).toBe(true)
    expect(snapshotHasCacheBuster).toBe(false)
  })
})
