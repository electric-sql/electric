/**
 * Utility for yielding control back to the main thread to prevent UI blocking.
 *
 * This is particularly useful when processing large amounts of data (like parsing
 * large shapes) to ensure the UI remains responsive.
 */

/**
 * Default number of items to process before yielding to the main thread.
 * This value balances responsiveness with overhead from yielding.
 */
export const DEFAULT_YIELD_EVERY = 1000

/**
 * Yields control back to the main thread, allowing the browser to handle
 * user interactions, rendering, and other tasks.
 *
 * Uses `scheduler.yield()` if available (Chrome 129+, behind flag in other browsers),
 * otherwise falls back to `setTimeout(0)`.
 *
 * @returns A promise that resolves after yielding to the main thread
 */
export function yieldToMain(): Promise<void> {
  // Check if scheduler.yield is available (modern browsers)
  // Guard typeof globalThis first to avoid reference errors in exotic environments
  if (typeof globalThis !== `undefined`) {
    const g = globalThis as GlobalWithScheduler
    if (g.scheduler && typeof g.scheduler.yield === `function`) {
      return g.scheduler.yield()
    }
  }

  // Fallback to setTimeout(0) which yields to the event loop
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Type definitions for the Scheduler API (available in some modern browsers)
interface GlobalWithScheduler {
  scheduler?: {
    yield: () => Promise<void>
  }
}
