/**
 * Tracks up-to-date messages to detect when we're replaying cached responses.
 *
 * When a shape receives an up-to-date, we record the timestamp in localStorage.
 * On page refresh, if we find a recent timestamp (< 60s), we know we'll be
 * replaying cached responses and should suppress their up-to-date notifications
 * until we reach live mode with fresh data from the server.
 */
export class UpToDateTracker {
  private data: Record<string, number> = {}
  private readonly storageKey = `electric_up_to_date_tracker`
  private readonly cacheTTL = 60_000 // 60s to match HTTP s-maxage cache
  private readonly maxEntries = 250

  constructor() {
    this.load()
    this.cleanup()
  }

  /**
   * Records that a shape received an up-to-date message.
   * This timestamp is used to detect cache replay scenarios.
   */
  recordUpToDate(shapeKey: string): void {
    this.data[shapeKey] = Date.now()

    // Implement LRU eviction if we exceed max entries
    const keys = Object.keys(this.data)
    if (keys.length > this.maxEntries) {
      const oldest = keys.reduce((min, k) =>
        this.data[k] < this.data[min] ? k : min
      )
      delete this.data[oldest]
    }

    this.save()
  }

  /**
   * Checks if we should enter replay mode for this shape.
   * Returns true if there's a recent up-to-date (< 60s) which means
   * we'll likely be replaying cached responses on this page load.
   */
  shouldEnterReplayMode(shapeKey: string): boolean {
    const lastUpToDate = this.data[shapeKey]
    if (lastUpToDate === undefined) {
      return false
    }

    const age = Date.now() - lastUpToDate
    return age < this.cacheTTL
  }

  /**
   * Cleans up expired entries from the cache.
   * Called on initialization and can be called periodically.
   */
  private cleanup(): void {
    const now = Date.now()
    const keys = Object.keys(this.data)
    let modified = false

    for (const key of keys) {
      const age = now - this.data[key]
      if (age > this.cacheTTL) {
        delete this.data[key]
        modified = true
      }
    }

    if (modified) {
      this.save()
    }
  }

  private save(): void {
    if (typeof localStorage === `undefined`) return
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data))
    } catch {
      // Ignore localStorage errors (quota exceeded, etc.)
    }
  }

  private load(): void {
    if (typeof localStorage === `undefined`) return
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        this.data = JSON.parse(stored)
      }
    } catch {
      // Ignore localStorage errors, start fresh
      this.data = {}
    }
  }

  /**
   * Clears all tracked up-to-date timestamps.
   * Useful for testing or manual cache invalidation.
   */
  clear(): void {
    this.data = {}
    this.save()
  }
}

// Module-level singleton instance
export const upToDateTracker = new UpToDateTracker()
