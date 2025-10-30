/**
 * Tracks up-to-date messages to prevent multiple notifications
 * when cached responses are replayed on page refresh.
 *
 * The tracker uses localStorage to persist timestamps across page loads
 * and a short-term in-memory window for rapid message deduplication.
 */
export class UpToDateTracker {
  private data: Record<string, number> = {}
  private readonly storageKey = `electric_up_to_date_tracker`
  private readonly cacheTTL = 60_000 // 60s to match HTTP s-maxage cache
  private readonly suppressionWindowMs = 1000 // 1s for rapid message deduplication
  private lastNotificationTime: Record<string, number> = {}
  private readonly maxEntries = 250

  constructor() {
    this.load()
    this.cleanup()
  }

  /**
   * Determines whether to notify subscribers about an up-to-date message.
   *
   * @param shapeKey - Canonical key identifying the shape
   * @param isLiveMessage - Whether this is a live message (SSE) vs cached (long-poll)
   * @returns true if subscribers should be notified, false if should be suppressed
   */
  shouldNotifySubscribers(shapeKey: string, isLiveMessage: boolean): boolean {
    const now = Date.now()

    // Always notify for live (SSE) messages and record them
    if (isLiveMessage) {
      this.recordUpToDate(shapeKey, now)
      return true
    }

    // Check if we have a recent up-to-date recorded in localStorage
    // If so, suppress cached responses during the TTL window
    const lastRecorded = this.data[shapeKey]
    if (lastRecorded !== undefined) {
      const age = now - lastRecorded
      if (age < this.cacheTTL) {
        // This is likely a cached response from the HTTP cache
        // Don't notify subscribers but do update state
        return false
      }
    }

    // Also check short-term deduplication window
    // This handles rapid successive up-to-dates within a single session
    const lastNotification = this.lastNotificationTime[shapeKey]
    if (lastNotification !== undefined) {
      const timeSinceLast = now - lastNotification
      if (timeSinceLast < this.suppressionWindowMs) {
        return false
      }
    }

    // No recent up-to-date found, allow notification and record it
    this.recordUpToDate(shapeKey, now)
    return true
  }

  /**
   * Records an up-to-date message for a shape.
   * Updates both localStorage and in-memory tracking.
   */
  private recordUpToDate(
    shapeKey: string,
    timestamp: number = Date.now()
  ): void {
    this.data[shapeKey] = timestamp
    this.lastNotificationTime[shapeKey] = timestamp

    // Implement LRU eviction if we exceed max entries
    const keys = Object.keys(this.data)
    if (keys.length > this.maxEntries) {
      const oldest = keys.reduce((min, k) =>
        this.data[k] < this.data[min] ? k : min
      )
      delete this.data[oldest]
      delete this.lastNotificationTime[oldest]
    }

    this.save()
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
        delete this.lastNotificationTime[key]
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
    this.lastNotificationTime = {}
    this.save()
  }
}

// Module-level singleton instance
export const upToDateTracker = new UpToDateTracker()
