import {
  CHUNK_LAST_OFFSET_HEADER,
  CHUNK_UP_TO_DATE_HEADER,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  SHAPE_ID_HEADER,
  SHAPE_ID_QUERY_PARAM,
} from './constants'
import { FetchError, FetchBackoffAbortError } from './error'

export interface BackoffOptions {
  /**
   * Initial delay before retrying in milliseconds
   */
  initialDelay: number
  /**
   * Maximum retry delay in milliseconds
   */
  maxDelay: number
  multiplier: number
  onFailedAttempt?: () => void
  debug?: boolean
}

export const BackoffDefaults = {
  initialDelay: 100,
  maxDelay: 10_000,
  multiplier: 1.3,
}

export function createFetchWithBackoff(
  fetchClient: typeof fetch,
  backoffOptions: BackoffOptions = BackoffDefaults
): typeof fetch {
  const {
    initialDelay,
    maxDelay,
    multiplier,
    debug = false,
    onFailedAttempt,
  } = backoffOptions
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = args[0]
    const options = args[1]

    let delay = initialDelay
    let attempt = 0

    /* eslint-disable no-constant-condition -- we re-fetch the shape log
     * continuously until we get a non-ok response. For recoverable errors,
     * we retry the fetch with exponential backoff. Users can pass in an
     * AbortController to abort the fetching an any point.
     * */
    while (true) {
      /* eslint-enable no-constant-condition */
      try {
        const result = await fetchClient(...args)
        if (result.ok) return result
        else throw await FetchError.fromResponse(result, url.toString())
      } catch (e) {
        onFailedAttempt?.()
        if (options?.signal?.aborted) {
          throw new FetchBackoffAbortError()
        } else if (
          e instanceof FetchError &&
          e.status >= 400 &&
          e.status < 500
        ) {
          // Any client errors cannot be backed off on, leave it to the caller to handle.
          throw e
        } else {
          // Exponentially backoff on errors.
          // Wait for the current delay duration
          await new Promise((resolve) => setTimeout(resolve, delay))

          // Increase the delay for the next attempt
          delay = Math.min(delay * multiplier, maxDelay)

          if (debug) {
            attempt++
            console.log(`Retry attempt #${attempt} after ${delay}ms`)
          }
        }
      }
    }
  }
}

interface ChunkPrefetchOptions {
  maxChunksToPrefetch: number
}

const ChunkPrefetchDefaults = {
  maxChunksToPrefetch: 2,
}

/**
 * Creates a fetch client that prefetches subsequent log chunks for
 * consumption by the shape stream without waiting for the chunk bodies
 * themselves to be loaded.
 *
 * @param fetchClient the client to wrap
 * @param prefetchOptions options to configure prefetching
 * @returns wrapped client with prefetch capabilities
 */
export function createFetchWithChunkBuffer(
  fetchClient: typeof fetch,
  prefetchOptions: ChunkPrefetchOptions = ChunkPrefetchDefaults
): typeof fetch {
  const prefetchMap: Map<string, Promise<Response>> = new Map()
  let prefetchAborter: AbortController = new AbortController()

  const getNextUrlToPrefetch = async (
    url: string,
    response: Response
  ): Promise<string | void> => {
    // do not prefetch next response if current fails
    if (!response.ok) return

    // check if next request is already prefetched and recursively
    // follow chain until first request that has not been prefetched is found
    const nextUrl = getNextChunkUrl(url, response)
    if (nextUrl && prefetchMap.has(nextUrl)) {
      return prefetchMap
        .get(nextUrl)!
        .then((res) => getNextUrlToPrefetch(nextUrl, res))
        .catch(() => {})
    }

    return nextUrl
  }

  const prefetchClient = async (
    prefetchedRequest?: Promise<Response>,
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const url = args[0].toString()
    const result = await (prefetchedRequest ?? fetchClient(...args))

    // kick off a prefetch of the next response if available
    getNextUrlToPrefetch(url, result).then((nextUrl) => {
      // if aborted or unavailable, terminate prefetch chain
      if (args[1]?.signal?.aborted || !nextUrl) return

      // do not prefetch more than specified amount
      if (prefetchMap.size >= prefetchOptions.maxChunksToPrefetch) return

      const prefetchPromise = prefetchClient(
        prefetchMap.get(nextUrl),
        nextUrl,
        args[1]
      )

      // delete prefetched requests that fail to avoid polluting chain
      prefetchPromise.catch(() => prefetchMap.delete(nextUrl))
      prefetchMap.set(nextUrl, prefetchPromise)
    })

    return result
  }

  const prefetchEntryClient = (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const url = args[0].toString()
    const prefetchedRequest = prefetchMap.get(url)

    // if a prefetched request for given URL is not available, clear all current
    // prefetched requests and start again, as request that came in does not belong
    // in the current "prefetch chain" and should start a new one (e.g. shape rotation)
    if (!prefetchedRequest) {
      prefetchAborter.abort()
      prefetchMap.clear()
      prefetchAborter = new AbortController()
      return prefetchClient(undefined, args[0], {
        ...(args[1] ?? {}),
        signal: chainAborter(prefetchAborter, args[1]?.signal),
      })
    }

    // otherwise consume prefetched request and attempt to prefetch more
    prefetchMap.delete(url)
    return prefetchClient(prefetchedRequest, url, {
      ...(args[1] ?? {}),
      signal: prefetchAborter.signal,
    })
  }

  return prefetchEntryClient
}

/**
 * Generate the next chunk's URL if the url and response are valid
 */
function getNextChunkUrl(url: string, res: Response): string | void {
  const shapeId = res.headers.get(SHAPE_ID_HEADER)
  const lastOffset = res.headers.get(CHUNK_LAST_OFFSET_HEADER)
  const isUpToDate = res.headers.get(CHUNK_UP_TO_DATE_HEADER)

  // only prefetch if shape ID and offset for next chunk are available, and
  // response is not already up-to-date
  if (!shapeId || !lastOffset || isUpToDate) return

  const nextUrl = new URL(url)

  // don't prefetch live requests, rushing them will only
  // potentially miss more recent data
  if (nextUrl.searchParams.has(LIVE_QUERY_PARAM)) return

  nextUrl.searchParams.set(SHAPE_ID_QUERY_PARAM, shapeId)
  nextUrl.searchParams.set(OFFSET_QUERY_PARAM, lastOffset)
  return nextUrl.toString()
}

/**
 * Chains an abort controller on an optional source signal's
 * aborted state - if the source signal is aborted, the provided abort
 * controller will also abort
 */
function chainAborter(
  aborter: AbortController,
  sourceSignal?: AbortSignal
): AbortSignal {
  if (!sourceSignal) return aborter.signal
  if (sourceSignal.aborted) aborter.abort()
  else
    sourceSignal.addEventListener(`abort`, () => aborter.abort(), {
      once: true,
    })
  return aborter.signal
}
