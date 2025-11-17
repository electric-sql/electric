import { describe, beforeEach, it, expect, vi, type Mock } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { FetchError, FetchBackoffAbortError } from '../src/error'
import {
  createFetchWithBackoff,
  BackoffDefaults,
  createFetchWithChunkBuffer,
  createFetchWithConsumedMessages,
  parseRetryAfterHeader,
} from '../src/fetch'
import { CHUNK_LAST_OFFSET_HEADER, SHAPE_HANDLE_HEADER } from '../src/constants'
import { afterEach } from 'node:test'

describe(`createFetchWithBackoff`, () => {
  const initialDelay = 10
  const maxDelay = 100
  let mockFetchClient: Mock<typeof fetch>

  beforeEach(() => {
    mockFetchClient = vi.fn()
  })

  it(`should return a successful response on the first attempt`, async () => {
    const mockResponse = new Response(null, { status: 200, statusText: `OK` })
    mockFetchClient.mockResolvedValue(mockResponse)

    const fetchWithBackoff = createFetchWithBackoff(mockFetchClient)

    const result = await fetchWithBackoff(`https://example.com`)

    expect(mockFetchClient).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(result).toEqual(mockResponse)
  })

  it(`should retry the request on a 500 response and succeed after a retry`, async () => {
    const mockErrorResponse = new Response(null, { status: 500 })
    const mockSuccessResponse = new Response(null, {
      status: 200,
      statusText: `OK`,
    })
    mockFetchClient
      .mockResolvedValueOnce(mockErrorResponse)
      .mockResolvedValueOnce(mockSuccessResponse)

    const fetchWithBackoff = createFetchWithBackoff(mockFetchClient, {
      ...BackoffDefaults,
      initialDelay,
    })

    const result = await fetchWithBackoff(`https://example.com`)

    expect(mockFetchClient).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
  })

  it(`should retry the request on a 429 response and succeed after a retry`, async () => {
    const mockErrorResponse = new Response(null, { status: 429 })
    const mockSuccessResponse = new Response(null, {
      status: 200,
      statusText: `OK`,
    })
    mockFetchClient
      .mockResolvedValueOnce(mockErrorResponse)
      .mockResolvedValueOnce(mockSuccessResponse)

    const fetchWithBackoff = createFetchWithBackoff(mockFetchClient, {
      ...BackoffDefaults,
      initialDelay,
    })

    const result = await fetchWithBackoff(`https://example.com`)

    expect(mockFetchClient).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
  })

  it(`should apply exponential backoff and retry until maxDelay is reached`, async () => {
    const mockErrorResponse = new Response(null, { status: 500 })
    const mockSuccessResponse = new Response(null, {
      status: 200,
      statusText: `OK`,
    })
    mockFetchClient
      .mockResolvedValueOnce(mockErrorResponse)
      .mockResolvedValueOnce(mockErrorResponse)
      .mockResolvedValueOnce(mockErrorResponse)
      .mockResolvedValueOnce(mockSuccessResponse)

    const multiplier = 2

    const fetchWithBackoff = createFetchWithBackoff(mockFetchClient, {
      initialDelay,
      maxDelay,
      multiplier,
    })

    const result = await fetchWithBackoff(`https://example.com`)

    expect(mockFetchClient).toHaveBeenCalledTimes(4)
    expect(result.ok).toBe(true)
  })

  it(`should stop retrying and throw an error on a 400 response`, async () => {
    const mockErrorResponse = new Response(null, {
      status: 400,
      statusText: `Bad Request`,
    })
    mockFetchClient.mockResolvedValue(mockErrorResponse)

    const fetchWithBackoff = createFetchWithBackoff(mockFetchClient)

    await expect(fetchWithBackoff(`https://example.com`)).rejects.toThrow(
      FetchError
    )
    expect(mockFetchClient).toHaveBeenCalledTimes(1)
  })

  it(`should throw FetchBackoffAborted if the abort signal is triggered`, async () => {
    const mockAbortController = new AbortController()
    const signal = mockAbortController.signal
    const mockErrorResponse = new Response(null, { status: 500 })
    mockFetchClient.mockImplementation(
      () => new Promise((res) => setTimeout(() => res(mockErrorResponse), 10))
    )

    const fetchWithBackoff = createFetchWithBackoff(mockFetchClient, {
      ...BackoffDefaults,
      initialDelay: 1000,
    })

    setTimeout(() => mockAbortController.abort(), 5)

    await expect(
      fetchWithBackoff(`https://example.com`, { signal })
    ).rejects.toThrow(FetchBackoffAbortError)

    expect(mockFetchClient).toHaveBeenCalledTimes(1)
  })

  it(`should not retry when a client error (4xx) occurs`, async () => {
    const mockErrorResponse = new Response(null, {
      status: 403,
      statusText: `Forbidden`,
    })
    mockFetchClient.mockResolvedValue(mockErrorResponse)

    const fetchWithBackoff = createFetchWithBackoff(
      mockFetchClient,
      BackoffDefaults
    )

    await expect(fetchWithBackoff(`https://example.com`)).rejects.toThrow(
      FetchError
    )
    expect(mockFetchClient).toHaveBeenCalledTimes(1)
  })

  it(`should honor retry-after header from 503 response`, async () => {
    const retryAfterSeconds = 2
    const mockErrorResponse = new Response(null, {
      status: 503,
      statusText: `Service Unavailable`,
      headers: new Headers({ 'retry-after': `${retryAfterSeconds}` }),
    })
    const mockSuccessResponse = new Response(null, {
      status: 200,
      statusText: `OK`,
    })
    mockFetchClient
      .mockResolvedValueOnce(mockErrorResponse)
      .mockResolvedValueOnce(mockSuccessResponse)

    const fetchWithBackoff = createFetchWithBackoff(mockFetchClient, {
      ...BackoffDefaults,
      initialDelay: 1, // Very short client delay
    })

    const startTime = Date.now()
    const result = await fetchWithBackoff(`https://example.com`)
    const elapsed = Date.now() - startTime

    // Should have waited at least retryAfterSeconds (minus small tolerance for test execution)
    expect(elapsed).toBeGreaterThanOrEqual(retryAfterSeconds * 1000 - 100)
    expect(mockFetchClient).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
  })

  // it(`should retry multiple times and eventually throw if no success`, async () => {
  //   const mockErrorResponse = new Response(null, { status: 500 })
  //   mockFetchClient.mockImplementation(
  //     () => new Promise((res) => setTimeout(() => res(mockErrorResponse), 10))
  //   )

  //   const fetchWithBackoff = createFetchWithBackoff(mockFetchClient, {
  //     ...BackoffDefaults,
  //     initialDelay,
  //     maxDelay,
  //   })

  //   await expect(fetchWithBackoff(`https://example.com`)).rejects.toThrow(
  //     FetchError
  //   )
  //   expect(mockFetchClient.mock.calls.length).greaterThan(1)
  // })
})

describe(`parseRetryAfterHeader`, () => {
  it(`should return 0 for undefined header`, () => {
    expect(parseRetryAfterHeader(undefined)).toBe(0)
  })

  it(`should return 0 for empty string`, () => {
    expect(parseRetryAfterHeader(``)).toBe(0)
  })

  it(`should parse delta-seconds format correctly`, () => {
    expect(parseRetryAfterHeader(`120`)).toBe(120_000) // 120 seconds = 120,000 ms
    expect(parseRetryAfterHeader(`1`)).toBe(1_000)
    expect(parseRetryAfterHeader(`60`)).toBe(60_000)
  })

  it(`should return 0 for invalid delta-seconds values`, () => {
    expect(parseRetryAfterHeader(`-10`)).toBe(0) // Negative values
    expect(parseRetryAfterHeader(`0`)).toBe(0) // Zero
    expect(parseRetryAfterHeader(`abc`)).toBe(0) // Non-numeric
  })

  it(`should parse HTTP-date format correctly`, () => {
    const futureDate = new Date(Date.now() + 30_000) // 30 seconds in the future
    const httpDate = futureDate.toUTCString()
    const result = parseRetryAfterHeader(httpDate)

    // Should be approximately 30 seconds, allow some tolerance for test execution time
    expect(result).toBeGreaterThan(29_000)
    expect(result).toBeLessThan(31_000)
  })

  it(`should handle clock skew for past dates`, () => {
    const pastDate = new Date(Date.now() - 10_000) // 10 seconds in the past
    const httpDate = pastDate.toUTCString()

    // Should clamp to 0 for past dates
    expect(parseRetryAfterHeader(httpDate)).toBe(0)
  })

  it(`should cap very large HTTP-date values at 1 hour`, () => {
    const farFutureDate = new Date(Date.now() + 7200_000) // 2 hours in the future
    const httpDate = farFutureDate.toUTCString()

    // Should be capped at 1 hour (3600000 ms)
    expect(parseRetryAfterHeader(httpDate)).toBe(3600_000)
  })

  it(`should return 0 for invalid HTTP-date format`, () => {
    expect(parseRetryAfterHeader(`not a date`)).toBe(0)
    expect(parseRetryAfterHeader(`2024-13-45`)).toBe(0) // Invalid date
  })

  it(`should handle edge case of very large delta-seconds`, () => {
    // Very large number (more than 1 hour worth of seconds)
    expect(parseRetryAfterHeader(`7200`)).toBe(7200_000) // 2 hours in ms (not capped in delta-seconds format)
  })

  it(`should handle decimal numbers in delta-seconds format`, () => {
    // HTTP spec requires delta-seconds to be integers, but parsing as Number allows decimals
    expect(parseRetryAfterHeader(`30.5`)).toBe(30_500)
  })
})

describe(`createFetchWithChunkBuffer`, () => {
  const baseUrl = `https://example.com/v1/shape?table=foo`
  let mockFetch: Mock<typeof fetch>
  const responseHeaders = (headers: Record<string, string>) => {
    return new Headers(headers)
  }

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  it(`should perform a basic fetch when no prefetch metadata is available`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch)
    const mockResponse = new Response(`test response`, {
      status: 200,
    })

    mockFetch.mockResolvedValueOnce(mockResponse)

    const result = await fetchWrapper(baseUrl)
    expect(result).toBe(mockResponse)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(baseUrl)
  })

  it(`should prefetch the next chunk when headers are present`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch)
    const initialResponse = new Response(`initial chunk`, {
      status: 200,
      headers: responseHeaders({
        [SHAPE_HANDLE_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `456`,
      }),
    })

    const nextResponse = new Response(`next chunk`, {
      status: 200,
    })

    mockFetch.mockResolvedValueOnce(initialResponse)
    mockFetch.mockResolvedValueOnce(nextResponse)

    const result = await fetchWrapper(baseUrl)
    expect(result).toBe(initialResponse)

    // Check if the next chunk was prefetched
    const nextUrl = sortUrlParams(`${baseUrl}&handle=123&offset=456`)
    expect(mockFetch).toHaveBeenCalledWith(nextUrl, expect.anything())
  })

  it(`should stop and resume prefetching after reaching maxChunksToPrefetch`, async () => {
    const maxPrefetchNum = 2
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch, {
      maxChunksToPrefetch: maxPrefetchNum,
    })

    const responses = Array.from(
      // initial + prefetched + next prefetch after one consumed
      { length: 1 + maxPrefetchNum + 1 },
      (_, idx) =>
        new Response(`next chunk`, {
          status: 200,
          headers: responseHeaders({
            [SHAPE_HANDLE_HEADER]: `123`,
            [CHUNK_LAST_OFFSET_HEADER]: `${idx}`,
          }),
        })
    )
    responses.forEach((response) => mockFetch.mockResolvedValueOnce(response))

    // First request should trigger one prefetch
    await fetchWrapper(baseUrl)
    await sleep()

    // Check fetch call count: 1 for initial, maxPrefetchNum for prefetch
    expect(mockFetch).toHaveBeenCalledTimes(1 + maxPrefetchNum)
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      sortUrlParams(`${baseUrl}&handle=123&offset=0`),
      expect.anything()
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      sortUrlParams(`${baseUrl}&handle=123&offset=1`),
      expect.anything()
    )

    // Second request consumes one of the prefetched responses and
    // next one fires up
    await fetchWrapper(sortUrlParams(`${baseUrl}&handle=123&offset=0`))
    await sleep()
    expect(mockFetch).toHaveBeenCalledTimes(1 + maxPrefetchNum + 1)
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      sortUrlParams(`${baseUrl}&handle=123&offset=2`),
      expect.anything()
    )
  })

  it(`should stop prefetching as soon as responses are not advancing`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch)
    const initialResponse = new Response(`initial chunk`, {
      status: 200,
      headers: responseHeaders({
        [SHAPE_HANDLE_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `456`,
      }),
    })

    const nextResponse = new Response(`next chunk`, {
      status: 200,
      headers: responseHeaders({
        [SHAPE_HANDLE_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `456`,
      }),
    })

    mockFetch.mockResolvedValueOnce(initialResponse)
    mockFetch.mockResolvedValueOnce(nextResponse)
    // mockFetch.mockResolvedValueOnce(nextResponse)

    const result = await fetchWrapper(baseUrl)
    expect(result).toBe(initialResponse)

    // fetch the next chunk as well
    const nextUrl = sortUrlParams(`${baseUrl}&handle=123&offset=456`)
    const nextResult = await fetchWrapper(nextUrl)
    expect(nextResult).toBe(nextResponse)

    expect(mockFetch).toHaveBeenNthCalledWith(1, baseUrl)
    expect(mockFetch).toHaveBeenNthCalledWith(2, nextUrl, expect.anything())
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it(`should not prefetch if response is not ok`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch)
    const mockErrorResponse = new Response(`error`, {
      status: 500,
    })

    mockFetch.mockResolvedValueOnce(mockErrorResponse)

    const result = await fetchWrapper(baseUrl)
    expect(result).toBe(mockErrorResponse)

    // Ensure no prefetch was attempted
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it(`should handle failed prefetch attempts gracefully`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch)

    const initialResponse = new Response(`initial chunk`, {
      status: 200,
      headers: responseHeaders({
        [SHAPE_HANDLE_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `456`,
      }),
    })

    mockFetch.mockResolvedValueOnce(initialResponse)
    mockFetch.mockRejectedValueOnce(new Error(`Prefetch failed`))

    const result = await fetchWrapper(baseUrl)
    expect(result).toBe(initialResponse)

    // Prefetch should have been attempted but failed
    const nextUrl = sortUrlParams(`${baseUrl}&handle=123&offset=456`)

    expect(mockFetch).toHaveBeenCalledWith(nextUrl, expect.anything())

    // One for the main request, one for the prefetch
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it(`should clear and abort prefetches on new entry`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch, {
      maxChunksToPrefetch: 2,
    })

    Array.from({ length: 10 }, (_, idx) =>
      mockFetch.mockImplementationOnce(async () => {
        await sleep()
        return new Response(`chunk`, {
          status: 200,
          headers: responseHeaders({
            [SHAPE_HANDLE_HEADER]: `123`,
            [CHUNK_LAST_OFFSET_HEADER]: `${idx}`,
          }),
        })
      })
    )

    await fetchWrapper(baseUrl)

    // main + one prefetch - second prefetch not yet done
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // requesting a different path should clear the prefetches
    const altUrl = `${baseUrl}_alt`
    await fetchWrapper(altUrl)
    await sleep()

    // main + 2 prefetches of new URL
    expect(mockFetch).toHaveBeenCalledTimes(5)

    // should have called the base + prefetch of base
    expect(mockFetch).toHaveBeenNthCalledWith(1, baseUrl)
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      sortUrlParams(`${baseUrl}&handle=123&offset=0`),
      expect.anything()
    )

    // once interrupted it should have called the alt + the 2 prefetches
    expect(mockFetch).toHaveBeenNthCalledWith(3, altUrl)
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      sortUrlParams(`${altUrl}&handle=123&offset=2`),
      expect.anything()
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      5,
      sortUrlParams(`${altUrl}&handle=123&offset=3`),
      expect.anything()
    )
  })

  it(`should respect wrapped client's aborter`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch, {
      maxChunksToPrefetch: 2,
    })

    Array.from({ length: 10 }, (_, idx) =>
      mockFetch.mockImplementationOnce(async () => {
        await sleep()
        return new Response(`chunk`, {
          status: 200,
          headers: responseHeaders({
            [SHAPE_HANDLE_HEADER]: `123`,
            [CHUNK_LAST_OFFSET_HEADER]: `${idx}`,
          }),
        })
      })
    )

    const aborter = new AbortController()
    await fetchWrapper(baseUrl, { signal: aborter.signal })

    // main + one prefetch - second prefetch not yet done
    expect(mockFetch).toHaveBeenCalledTimes(2)
    aborter.abort()
    await sleep(10)

    // no new prefetches since main request was aborted
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

describe(`createFetchWithConsumedMessages`, () => {
  const mockFetch = vi.fn()

  afterEach(() => {
    vi.resetAllMocks()
  })

  it(`should return the original response for status codes < 200`, async () => {
    const mockResponse = {
      status: 199,
      text: vi.fn(),
      headers: new Headers(),
    }
    mockFetch.mockResolvedValue(mockResponse)

    const enhancedFetch = createFetchWithConsumedMessages(mockFetch)
    const result = await enhancedFetch(`http://example.com`)

    expect(result).toBe(mockResponse)
    expect(mockResponse.text).not.toHaveBeenCalled()
  })

  it(`should return the original response for status codes with no body (201, 204, 205)`, async () => {
    const mockResponse = {
      status: 204,
      text: vi.fn(),
      headers: new Headers(),
    }
    mockFetch.mockResolvedValue(mockResponse)

    const enhancedFetch = createFetchWithConsumedMessages(mockFetch)
    const result = await enhancedFetch(`http://example.com`)

    expect(result).toBe(mockResponse)
    expect(mockResponse.text).not.toHaveBeenCalled()
  })

  it(`should consume the body and return a new Response for successful status codes`, async () => {
    const mockText = `response body`
    const mockHeaders = new Headers({ 'content-type': `text/plain` })
    const mockResponse = {
      status: 200,
      text: vi.fn().mockResolvedValue(mockText),
      headers: mockHeaders,
    }
    mockFetch.mockResolvedValue(mockResponse)

    const enhancedFetch = createFetchWithConsumedMessages(mockFetch)
    const result = await enhancedFetch(`http://example.com`)

    expect(result).not.toBe(mockResponse)
    expect(result.status).toBe(200)
    expect(await result.text()).toBe(mockText)
    expect(mockResponse.text).toHaveBeenCalled()
  })

  it(`should throw FetchError when reading body fails`, async () => {
    const mockError = new Error(`Failed to read body`)
    const mockHeaders = new Headers({ 'content-type': `text/plain` })
    const mockResponse = {
      status: 200,
      text: vi.fn().mockRejectedValue(mockError),
      headers: mockHeaders,
    }
    mockFetch.mockResolvedValue(mockResponse)

    const enhancedFetch = createFetchWithConsumedMessages(mockFetch)
    const url = `http://example.com`

    await expect(() => enhancedFetch(url)).rejects.toThrow(FetchError)

    try {
      await enhancedFetch(url)
    } catch (error) {
      expect(error).toBeInstanceOf(FetchError)
      if (error instanceof FetchError) {
        expect(error.status).toBe(200)
        expect(error.url).toBe(url)
        expect(error.headers).toEqual(Object.fromEntries(mockHeaders.entries()))
        expect(error.message).toBe(mockError.message)
      }
    }
  })

  it(`should handle non-Error rejection values when reading body`, async () => {
    const mockResponse = {
      status: 200,
      text: vi.fn().mockRejectedValue(`some error string`),
      headers: new Headers(),
    }
    mockFetch.mockResolvedValue(mockResponse)

    const enhancedFetch = createFetchWithConsumedMessages(mockFetch)
    const url = `http://example.com`

    await expect(() => enhancedFetch(url)).rejects.toThrow(FetchError)

    try {
      await enhancedFetch(url)
    } catch (error) {
      expect(error).toBeInstanceOf(FetchError)
      if (error instanceof FetchError) {
        expect(error.message).toBe(`some error string`)
      }
    }
  })

  it(`should handle unknown rejection values when reading body`, async () => {
    const mockResponse = {
      status: 200,
      text: vi.fn().mockRejectedValue({ some: `object` }),
      headers: new Headers(),
    }
    mockFetch.mockResolvedValue(mockResponse)

    const enhancedFetch = createFetchWithConsumedMessages(mockFetch)
    const url = `http://example.com`

    await expect(() => enhancedFetch(url)).rejects.toThrow(FetchError)

    try {
      await enhancedFetch(url)
    } catch (error) {
      expect(error).toBeInstanceOf(FetchError)
      if (error instanceof FetchError) {
        expect(error.message).toBe(`failed to read body`)
      }
    }
  })
})

function sortUrlParams(url: string): string {
  const parsedUrl = new URL(url)
  parsedUrl.searchParams.sort()
  return parsedUrl.toString()
}
