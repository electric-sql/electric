import { FetchError } from './error'

export interface BackoffOptions {
  initialDelay: number
  maxDelay: number
  multiplier: number
  debug?: boolean
}

export const BackoffDefaults = {
  initialDelay: 100,
  maxDelay: 10_000,
  multiplier: 1.3,
}

export class FetchBackoffAborted extends Error {
  constructor() {
    super(`Fetch with backoff aborted`)
  }
}

export function createFetchWithBackoff(
  fetchClient: typeof fetch,
  backoffOptions: BackoffOptions = BackoffDefaults
): typeof fetch {
  const { initialDelay, maxDelay, multiplier, debug = false } = backoffOptions
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = args[0]
    const options = args[1]

    let delay = initialDelay
    let attempt = 0

    // eslint-disable-next-line no-constant-condition — we re-fetch the shape log continuously until we get a non-ok response. For recoverable errors, we retry the fetch with exponential backoff. Users can pass in an AbortController to abort the fetching an any point.
    while (true) {
      try {
        const result = await fetchClient(...args)
        if (result.ok) return result
        else throw await FetchError.fromResponse(result, url.toString())
      } catch (e) {
        if (options?.signal?.aborted) {
          throw new FetchBackoffAborted()
        } else if (
          e instanceof FetchError &&
          e.status >= 400 &&
          e.status < 500
        ) {
          // Any client errors cannot be backed off on, leave it to the caller to handle.
          throw e
        } else if (delay >= maxDelay) {
          // If max delay is passed, throw the error
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
