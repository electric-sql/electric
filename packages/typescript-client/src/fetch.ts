import {
  CHUNK_LAST_OFFSET_HEADER,
  CHUNK_UP_TO_DATE_HEADER,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_HEADER,
  SHAPE_HANDLE_QUERY_PARAM,
} from './constants'
import { FetchError, FetchBackoffAbortError } from './error'

// Some specific 4xx and 5xx HTTP status codes that we definitely
// want to retry
const HTTP_RETRY_STATUS_CODES = [429]

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
          !HTTP_RETRY_STATUS_CODES.includes(e.status) &&
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
  const { maxChunksToPrefetch } = prefetchOptions

  let prefetchQueue: PrefetchQueue

  const prefetchClient = async (...args: Parameters<typeof fetchClient>) => {
    const url = args[0].toString()

    // try to consume from the prefetch queue first, and if request is
    // not present abort the prefetch queue as it must no longer be valid
    const prefetchedRequest = prefetchQueue?.consume(...args)
    if (prefetchedRequest) {
      return prefetchedRequest
    }

    prefetchQueue?.abort()

    // perform request and fire off prefetch queue if request is eligible
    const response = await fetchClient(...args)
    const nextUrl = getNextChunkUrl(url, response)
    if (nextUrl) {
      prefetchQueue = new PrefetchQueue({
        fetchClient,
        maxPrefetchedRequests: maxChunksToPrefetch,
        url: nextUrl,
        requestInit: args[1],
      })
    }

    return response
  }

  return prefetchClient
}

class PrefetchQueue {
  readonly #fetchClient: typeof fetch
  readonly #maxPrefetchedRequests: number
  readonly #prefetchQueue = new Map<
    string,
    [Promise<Response>, AbortController]
  >()
  #queueHeadUrl: string | void
  #queueTailUrl: string | void

  constructor(options: {
    url: Parameters<typeof fetch>[0]
    requestInit: Parameters<typeof fetch>[1]
    maxPrefetchedRequests: number
    fetchClient?: typeof fetch
  }) {
    this.#fetchClient =
      options.fetchClient ??
      ((...args: Parameters<typeof fetch>) => fetch(...args))
    this.#maxPrefetchedRequests = options.maxPrefetchedRequests
    this.#queueHeadUrl = options.url.toString()
    this.#queueTailUrl = this.#queueHeadUrl
    this.#prefetch(options.url, options.requestInit)
  }

  abort(): void {
    this.#prefetchQueue.forEach(([_, aborter]) => aborter.abort())
  }

  consume(...args: Parameters<typeof fetch>): Promise<Response> | void {
    const url = args[0].toString()

    const request = this.#prefetchQueue.get(url)?.[0]
    // only consume if request is in queue and is the queue "head"
    // if request is in the queue but not the head, the queue is being
    // consumed out of order and should be restarted
    if (!request || url !== this.#queueHeadUrl) return
    this.#prefetchQueue.delete(url)

    // fire off new prefetch since request has been consumed
    request
      .then((response) => {
        const nextUrl = getNextChunkUrl(url, response)
        this.#queueHeadUrl = nextUrl
        if (
          this.#queueTailUrl &&
          !this.#prefetchQueue.has(this.#queueTailUrl)
        ) {
          this.#prefetch(this.#queueTailUrl, args[1])
        }
      })
      .catch(() => {})

    return request
  }

  #prefetch(...args: Parameters<typeof fetch>): void {
    const url = args[0].toString()

    // only prefetch when queue is not full
    if (this.#prefetchQueue.size >= this.#maxPrefetchedRequests) return

    // initialize aborter per request, to avoid aborting consumed requests that
    // are still streaming their bodies to the consumer
    const aborter = new AbortController()

    try {
      const request = this.#fetchClient(url, {
        ...(args[1] ?? {}),
        signal: chainAborter(aborter, args[1]?.signal),
      })
      this.#prefetchQueue.set(url, [request, aborter])
      request
        .then((response) => {
          // only keep prefetching if response chain is uninterrupted
          if (!response.ok || aborter.signal.aborted) return

          const nextUrl = getNextChunkUrl(url, response)

          // only prefetch when there is a next URL
          if (!nextUrl || nextUrl === url) {
            this.#queueTailUrl = undefined
            return
          }

          this.#queueTailUrl = nextUrl
          return this.#prefetch(nextUrl, args[1])
        })
        .catch(() => {})
    } catch (_) {
      // ignore prefetch errors
    }
  }
}

/**
 * Generate the next chunk's URL if the url and response are valid
 */
function getNextChunkUrl(url: string, res: Response): string | void {
  const shapeId = res.headers.get(SHAPE_HANDLE_HEADER)
  const lastOffset = res.headers.get(CHUNK_LAST_OFFSET_HEADER)
  const isUpToDate = res.headers.has(CHUNK_UP_TO_DATE_HEADER)

  // only prefetch if shape ID and offset for next chunk are available, and
  // response is not already up-to-date
  if (!shapeId || !lastOffset || isUpToDate) return

  const nextUrl = new URL(url)

  // don't prefetch live requests, rushing them will only
  // potentially miss more recent data
  if (nextUrl.searchParams.has(LIVE_QUERY_PARAM)) return

  nextUrl.searchParams.set(SHAPE_HANDLE_QUERY_PARAM, shapeId)
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
