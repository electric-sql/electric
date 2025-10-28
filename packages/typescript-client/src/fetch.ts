import {
  CHUNK_LAST_OFFSET_HEADER,
  CHUNK_UP_TO_DATE_HEADER,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_HEADER,
  SHAPE_HANDLE_QUERY_PARAM,
  SUBSET_PARAM_LIMIT,
  SUBSET_PARAM_OFFSET,
  SUBSET_PARAM_ORDER_BY,
  SUBSET_PARAM_WHERE,
  SUBSET_PARAM_WHERE_PARAMS,
} from './constants'
import {
  FetchError,
  FetchBackoffAbortError,
  MissingHeadersError,
} from './error'

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
   * After reaching this, delay stays constant (e.g., retry every 60s)
   */
  maxDelay: number
  multiplier: number
  onFailedAttempt?: () => void
  debug?: boolean
  /**
   * Maximum number of retry attempts before giving up.
   * Set to Infinity (default) for indefinite retries - needed for offline scenarios
   * where clients may go offline and come back later.
   *
   * The retry budget provides protection against retry storms even with infinite retries.
   */
  maxRetries?: number
  /**
   * Percentage of requests that can be retries (0.1 = 10%)
   *
   * This is the primary load shedding mechanism. It limits the *rate* of retries,
   * not the total count. Even with infinite retries, at most 10% of your traffic
   * will be retries, preventing retry storms from amplifying server load.
   *
   * The budget resets every 60 seconds, so a temporary spike of errors won't
   * permanently exhaust the budget.
   */
  retryBudgetPercent?: number
}

export const BackoffDefaults = {
  initialDelay: 100,
  maxDelay: 60_000, // Cap at 60s - reasonable for long-lived connections
  multiplier: 1.3,
  maxRetries: Infinity, // Retry forever - clients may go offline and come back
  retryBudgetPercent: 0.1, // 10% retry budget prevents amplification
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
    maxRetries = Infinity,
    retryBudgetPercent = 0.1,
  } = backoffOptions

  // Retry budget tracking (closure-scoped)
  // Resets every minute to prevent retry storms
  let totalRequests = 0
  let totalRetries = 0
  let budgetResetTime = Date.now() + 60_000

  function checkRetryBudget(percent: number): boolean {
    const now = Date.now()
    if (now > budgetResetTime) {
      totalRequests = 0
      totalRetries = 0
      budgetResetTime = now + 60_000
    }

    totalRequests++

    // Allow retries for first 10 requests to avoid cold start issues
    if (totalRequests < 10) return true

    const currentRetryRate = totalRetries / totalRequests
    const hasCapacity = currentRetryRate < percent

    if (hasCapacity) {
      totalRetries++
    }

    return hasCapacity
  }
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = args[0]
    const options = args[1]

    let delay = initialDelay
    let attempt = 0

    while (true) {
      try {
        const result = await fetchClient(...args)
        if (result.ok) {
          // Reset backoff on successful request
          delay = initialDelay
          return result
        }

        const err = await FetchError.fromResponse(result, url.toString())

        throw err
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
          // Check retry budget and max retries
          attempt++
          if (attempt >= maxRetries) {
            if (debug) {
              console.log(
                `Max retries reached (${attempt}/${maxRetries}), giving up`
              )
            }
            throw e
          }

          // Check retry budget - this is our primary load shedding mechanism
          // It limits the *rate* of retries (10% of traffic) not the count
          // This prevents retry storms even with infinite retries
          if (!checkRetryBudget(retryBudgetPercent)) {
            if (debug) {
              console.log(
                `Retry budget exhausted (attempt ${attempt}), backing off`
              )
            }
            // Wait for maxDelay before checking budget again
            // This prevents tight retry loops when budget is exhausted
            await new Promise((resolve) => setTimeout(resolve, maxDelay))
            // Don't throw - continue retrying after the wait
            // This allows offline clients to eventually reconnect
            continue
          }

          // Calculate wait time honoring server-driven backoff as a floor
          // Precedence: max(serverMinimum, min(clientMaxDelay, backoffWithJitter))

          // 1. Parse server-provided Retry-After (if present)
          let serverMinimumMs = 0
          if (e instanceof FetchError && e.headers) {
            const retryAfter = e.headers[`retry-after`]
            if (retryAfter) {
              const retryAfterSec = Number(retryAfter)
              if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
                // Retry-After in seconds
                serverMinimumMs = retryAfterSec * 1000
              } else {
                // Retry-After as HTTP date
                const retryDate = Date.parse(retryAfter)
                if (!isNaN(retryDate)) {
                  // Handle clock skew: clamp to non-negative, cap at reasonable max
                  const deltaMs = retryDate - Date.now()
                  serverMinimumMs = Math.max(0, Math.min(deltaMs, 3600_000)) // Cap at 1 hour
                }
              }
            }
          }

          // 2. Calculate client backoff with full jitter
          const jitter = Math.random() * delay
          const clientBackoffMs = Math.min(jitter, maxDelay)

          // 3. Server minimum is the floor, client cap is the ceiling
          const waitMs = Math.max(serverMinimumMs, clientBackoffMs)

          if (debug) {
            const source = serverMinimumMs > 0 ? `server+client` : `client`
            console.log(
              `Retry attempt #${attempt} after ${waitMs}ms (${source}, serverMin=${serverMinimumMs}ms, clientBackoff=${clientBackoffMs}ms)`
            )
          }

          // Wait for the calculated duration
          await new Promise((resolve) => setTimeout(resolve, waitMs))

          // Increase the delay for the next attempt (capped at maxDelay)
          delay = Math.min(delay * multiplier, maxDelay)
        }
      }
    }
  }
}

const NO_BODY_STATUS_CODES = [201, 204, 205]

// Ensure body can actually be read in its entirety
export function createFetchWithConsumedMessages(fetchClient: typeof fetch) {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = args[0]
    const res = await fetchClient(...args)
    try {
      if (res.status < 200 || NO_BODY_STATUS_CODES.includes(res.status)) {
        return res
      }

      const text = await res.text()
      return new Response(text, res)
    } catch (err) {
      if (args[1]?.signal?.aborted) {
        throw new FetchBackoffAbortError()
      }

      throw new FetchError(
        res.status,
        undefined,
        undefined,
        Object.fromEntries([...res.headers.entries()]),
        url.toString(),
        err instanceof Error
          ? err.message
          : typeof err === `string`
            ? err
            : `failed to read body`
      )
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

export const requiredElectricResponseHeaders = [
  `electric-offset`,
  `electric-handle`,
]

export const requiredLiveResponseHeaders = [`electric-cursor`]

export const requiredNonLiveResponseHeaders = [`electric-schema`]

export function createFetchWithResponseHeadersCheck(
  fetchClient: typeof fetch
): typeof fetch {
  return async (...args: Parameters<typeof fetchClient>) => {
    const response = await fetchClient(...args)

    if (response.ok) {
      // Check that the necessary Electric headers are present on the response
      const headers = response.headers
      const missingHeaders: Array<string> = []

      const addMissingHeaders = (requiredHeaders: Array<string>) =>
        missingHeaders.push(...requiredHeaders.filter((h) => !headers.has(h)))

      const input = args[0]
      const urlString = input.toString()
      const url = new URL(urlString)

      // Snapshot responses (subset params) return a JSON object and do not include Electric chunk headers
      const isSnapshotRequest = [
        SUBSET_PARAM_WHERE,
        SUBSET_PARAM_WHERE_PARAMS,
        SUBSET_PARAM_LIMIT,
        SUBSET_PARAM_OFFSET,
        SUBSET_PARAM_ORDER_BY,
      ].some((p) => url.searchParams.has(p))
      if (isSnapshotRequest) {
        return response
      }

      addMissingHeaders(requiredElectricResponseHeaders)
      if (url.searchParams.get(LIVE_QUERY_PARAM) === `true`) {
        addMissingHeaders(requiredLiveResponseHeaders)
      }

      if (
        !url.searchParams.has(LIVE_QUERY_PARAM) ||
        url.searchParams.get(LIVE_QUERY_PARAM) === `false`
      ) {
        addMissingHeaders(requiredNonLiveResponseHeaders)
      }

      if (missingHeaders.length > 0) {
        throw new MissingHeadersError(urlString, missingHeaders)
      }
    }

    return response
  }
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
      const { signal, cleanup } = chainAborter(aborter, args[1]?.signal)
      const request = this.#fetchClient(url, { ...(args[1] ?? {}), signal })
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
        .finally(cleanup)
    } catch (_) {
      // ignore prefetch errors
    }
  }
}

/**
 * Generate the next chunk's URL if the url and response are valid
 */
function getNextChunkUrl(url: string, res: Response): string | void {
  const shapeHandle = res.headers.get(SHAPE_HANDLE_HEADER)
  const lastOffset = res.headers.get(CHUNK_LAST_OFFSET_HEADER)
  const isUpToDate = res.headers.has(CHUNK_UP_TO_DATE_HEADER)

  // only prefetch if shape handle and offset for next chunk are available, and
  // response is not already up-to-date
  if (!shapeHandle || !lastOffset || isUpToDate) return

  const nextUrl = new URL(url)

  // don't prefetch live requests, rushing them will only
  // potentially miss more recent data
  if (nextUrl.searchParams.has(LIVE_QUERY_PARAM)) return

  nextUrl.searchParams.set(SHAPE_HANDLE_QUERY_PARAM, shapeHandle)
  nextUrl.searchParams.set(OFFSET_QUERY_PARAM, lastOffset)
  nextUrl.searchParams.sort()
  return nextUrl.toString()
}

/**
 * Chains an abort controller on an optional source signal's
 * aborted state - if the source signal is aborted, the provided abort
 * controller will also abort
 */
function chainAborter(
  aborter: AbortController,
  sourceSignal?: AbortSignal | null
): {
  signal: AbortSignal
  cleanup: () => void
} {
  let cleanup = noop
  if (!sourceSignal) {
    // no-op, nothing to chain to
  } else if (sourceSignal.aborted) {
    // source signal is already aborted, abort immediately
    aborter.abort()
  } else {
    // chain to source signal abort event, and add callback to unlink
    // the aborter to avoid memory leaks
    const abortParent = () => aborter.abort()
    sourceSignal.addEventListener(`abort`, abortParent, {
      once: true,
      signal: aborter.signal,
    })
    cleanup = () => sourceSignal.removeEventListener(`abort`, abortParent)
  }

  return {
    signal: aborter.signal,
    cleanup,
  }
}

function noop() {}
