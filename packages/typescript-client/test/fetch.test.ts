import { describe, beforeEach, it, expect, vi, type Mock } from 'vitest'
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
  const baseUrl = `https://example.com/v1/shape/foo`
  let mockFetch: ReturnType<typeof vi.fn>
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
    const nextUrl = `${baseUrl}?shape_id=123&offset=456`
    expect(mockFetch).toHaveBeenCalledWith(nextUrl)
  })

  it(`should stop prefetching after reaching maxChunksToPrefetch`, async () => {
    const maxPrefetchNum = 2
    const fetchWrapper = createFetchWithChunkBuffer(mockFetch, {
      maxChunksToPrefetch: maxPrefetchNum,
    })

    const initialResponse = new Response(`initial chunk`, {
      status: 200,
      headers: responseHeaders({
        [SHAPE_ID_HEADER]: `123`,
        [CHUNK_LAST_OFFSET_HEADER]: `0`,
      }),
    })

    const responses = Array.from(
      { length: maxPrefetchNum + 1 },
      (_, idx) =>
        new Response(`next chunk`, {
          status: 200,
          headers: responseHeaders({
            [SHAPE_ID_HEADER]: `123`,
            [CHUNK_LAST_OFFSET_HEADER]: `${idx + 1}`,
          }),
        })
    )

    mockFetch.mockResolvedValueOnce(initialResponse)
    responses.forEach((response) => mockFetch.mockResolvedValueOnce(response))

    // First request should trigger one prefetch
    await fetchWrapper(baseUrl)

    // Check fetch call count: 1 for initial, maxPrefetchNum for prefetch
    expect(mockFetch).toHaveBeenCalledTimes(1 + maxPrefetchNum)
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
    const nextUrl = `${baseUrl}?shape_id=123&offset=456`
    expect(mockFetch).toHaveBeenCalledWith(nextUrl)

    // One for the main request, one for the prefetch
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
