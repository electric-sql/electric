import { describe, beforeEach, it, expect, vi, type Mock } from 'vitest'
import { setTimeout as sleep } from 'node:timers/promises'
import { FetchError, FetchBackoffAbortError } from '../src/error'
import {
  createFetchWithBackoff,
  BackoffDefaults,
  createFetchWithChunkBuffer,
} from '../src/fetch'
import { CHUNK_LAST_OFFSET_HEADER, SHAPE_ID_HEADER } from '../src/constants'

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
        [SHAPE_ID_HEADER]: `123`,
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
    const nextUrl = `${baseUrl}&shape_id=123&offset=456`
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
            [SHAPE_ID_HEADER]: `123`,
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
      `${baseUrl}&shape_id=123&offset=0`,
      expect.anything()
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      `${baseUrl}&shape_id=123&offset=1`,
      expect.anything()
    )

    // Second request consumes one of the prefetched responses and
    // next one fires up
    await fetchWrapper(`${baseUrl}&shape_id=123&offset=0`)
    await sleep()
    expect(mockFetch).toHaveBeenCalledTimes(1 + maxPrefetchNum + 1)
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      `${baseUrl}&shape_id=123&offset=2`,
      expect.anything()
    )
  })

  it(`should stop prefetching as soon as responses are not advancing`, async () => {
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch)
    const initialResponse = new Response(`initial chunk`, {
      status: 200,
      headers: responseHeaders({
        [SHAPE_ID_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `456`,
      }),
    })

    const nextResponse = new Response(`next chunk`, {
      status: 200,
      headers: responseHeaders({
        [SHAPE_ID_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `456`,
      }),
    })

    mockFetch.mockResolvedValueOnce(initialResponse)
    mockFetch.mockResolvedValueOnce(nextResponse)
    // mockFetch.mockResolvedValueOnce(nextResponse)

    const result = await fetchWrapper(baseUrl)
    expect(result).toBe(initialResponse)

    // fetch the next chunk as well
    const nextUrl = `${baseUrl}&shape_id=123&offset=456`
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
        [SHAPE_ID_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `456`,
      }),
    })

    mockFetch.mockResolvedValueOnce(initialResponse)
    mockFetch.mockRejectedValueOnce(new Error(`Prefetch failed`))

    const result = await fetchWrapper(baseUrl)
    expect(result).toBe(initialResponse)

    // Prefetch should have been attempted but failed
    const nextUrl = `${baseUrl}&shape_id=123&offset=456`
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
            [SHAPE_ID_HEADER]: `123`,
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
      `${baseUrl}&shape_id=123&offset=0`,
      expect.anything()
    )

    // once interrupted it should have called the alt + the 2 prefetches
    expect(mockFetch).toHaveBeenNthCalledWith(3, altUrl)
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      `${altUrl}&shape_id=123&offset=2`,
      expect.anything()
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      5,
      `${altUrl}&shape_id=123&offset=3`,
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
            [SHAPE_ID_HEADER]: `123`,
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
