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

function getNextChunkUrl(baseUrl: string, res: Response): string | null {
  const shapeId = res.headers.get(SHAPE_ID_HEADER)
  const lastOffset = res.headers.get(CHUNK_LAST_OFFSET_HEADER)
  const isUpToDate = res.headers.get(CHUNK_UP_TO_DATE_HEADER)

  // only prefetch if shape ID and offset for next chunk are available, and
  // response is not already up-to-date
  if (!shapeId || !lastOffset || isUpToDate) return null

  const nextUrl = new URL(baseUrl)

  // don't prefetch live requests, rushing them will only
  // potentially miss more recent data
  if (nextUrl.searchParams.has(LIVE_QUERY_PARAM)) return null

  nextUrl.searchParams.set(SHAPE_ID_QUERY_PARAM, shapeId)
  nextUrl.searchParams.set(OFFSET_QUERY_PARAM, lastOffset)
  return nextUrl.toString()
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

  const prefetchClient = async (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const result = await fetchClient(...args)

    // do not prefetch next response if current fails
    if (!result.ok || args[1]?.signal?.aborted) return result

    // do not prefetch more than specified amount
    if (prefetchMap.size >= prefetchOptions.maxChunksToPrefetch) return result

    const nextUrl = getNextChunkUrl(args[0].toString(), result)

    // do not prefetch if next URL is not valid or already prefetched
    if (!nextUrl || prefetchMap.has(nextUrl)) return result

    // prefetch next response and return current one using the prefetch
    // client to allow for subsequent responses to be prefetched
    try {
      const prefetchPromise = prefetchClient(nextUrl, args[1])
      prefetchPromise.catch(() => prefetchMap.delete(nextUrl))
      prefetchMap.set(nextUrl, prefetchPromise)
    } catch (_) {
      // ignore prefetch errors
    }

    return result
  }

  const prefetchEntryClient = (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const url = args[0].toString()

    // if already prefetched, serve that and delete from map
    const prefetchRes = prefetchMap.get(url)
    if (prefetchRes) {
      prefetchMap.delete(url)
      return prefetchRes
    }

    // otherwise clear current prefetched responses (and abort active requests)
    // and start again
    prefetchMap.clear()
    prefetchAborter.abort()
    prefetchAborter = new AbortController()
    args[1]?.signal?.addEventListener(`abort`, () => prefetchAborter.abort())
    return prefetchClient(args[0], {
      ...(args[1] ?? {}),
      signal: prefetchAborter.signal,
    })
  }

  return prefetchEntryClient
}
